import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import {
  createExtension,
  decideExtension,
  getExtension,
  listExtensions,
  listPendingExtensions,
  formatExtensionRequestedAt,
  validateExtensionInput,
  withdrawExtension,
} from "../src/lib/extensions.ts";
import { getTask } from "../src/lib/tasks.ts";

const input = { taskId: 3, requester: "sato", newDueDate: "2026-11-20", reason: "レビュー待ちのため" };

describe("validateExtensionInput", () => {
  it("accepts a valid date and a 1-500 character reason (trimmed)", () => {
    assert.deepEqual(validateExtensionInput({ newDueDate: "2026-11-20", reason: " 理由 " }), {
      ok: true,
      value: { newDueDate: "2026-11-20", reason: "理由" },
    });
    assert.equal(validateExtensionInput({ newDueDate: "2026-11-20", reason: "a".repeat(500) }).ok, true);
  });

  it("rejects bad dates", () => {
    for (const newDueDate of ["2026/11/20", "2026-1-2", "2026-02-30", "2026-13-01", "", 20261120, null, undefined]) {
      assert.equal(validateExtensionInput({ newDueDate, reason: "x" }).ok, false, String(newDueDate));
    }
  });

  it("rejects bad reasons and non-object bodies", () => {
    for (const reason of ["", "  ", "a".repeat(501), 1, null, undefined]) {
      assert.equal(validateExtensionInput({ newDueDate: "2026-11-20", reason }).ok, false, String(reason));
    }
    for (const body of [null, undefined, "x", []]) assert.equal(validateExtensionInput(body).ok, false);
  });
});

describe("createExtension / listExtensions", () => {
  it("creates a pending extension with the requester and a UTC timestamp", () => {
    const db = openDb();
    const ext = createExtension(input, db, new Date("2026-11-09T03:04:05.000Z"));
    assert.deepEqual(ext, {
      id: 1,
      taskId: 3,
      requester: "sato",
      newDueDate: "2026-11-20",
      reason: "レビュー待ちのため",
      status: "pending",
      createdAt: "2026-11-09T03:04:05.000Z",
      decidedBy: null,
      decidedAt: null,
    });
  });

  it("rejects a second request while one is pending (409)", () => {
    const db = openDb();
    createExtension(input, db);
    assert.equal(createExtension(input, db), "conflict");
    assert.equal(createExtension({ ...input, taskId: 4 }, db) === "conflict", false);
  });

  it("allows a new request after the previous one was decided, and lists oldest first", () => {
    const db = openDb();
    const first = createExtension(input, db) as { id: number };
    decideExtension(3, first.id, "rejected", "suzuki", db);
    const second = createExtension({ ...input, newDueDate: "2026-11-25" }, db);
    assert.notEqual(second, "conflict");
    assert.deepEqual(listExtensions(3, db).map((e) => e.status), ["rejected", "pending"]);
    assert.deepEqual(listExtensions(5, db), []);
  });
});

describe("decideExtension", () => {
  it("approves: records the decider and time, and changes the task's due date", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    const out = decideExtension(3, ext.id, "approved", "suzuki", db, new Date("2026-11-10T00:00:00.000Z"));
    assert.equal(out.result, "decided");
    if (out.result !== "decided") return;
    assert.equal(out.extension.status, "approved");
    assert.equal(out.extension.decidedBy, "suzuki");
    assert.equal(out.extension.decidedAt, "2026-11-10T00:00:00.000Z");
    assert.equal(out.task.dueDate, "2026-11-20");
    assert.equal(getTask(3, db)!.dueDate, "2026-11-20");
  });

  it("approves: sets the task's updatedAt to the decision time", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    const now = new Date("2026-11-10T00:00:00.000Z");
    assert.notEqual(getTask(3, db)!.updatedAt, now.toISOString());
    decideExtension(3, ext.id, "approved", "suzuki", db, now);
    assert.equal(getTask(3, db)!.updatedAt, now.toISOString());
  });

  it("rejects: records the decision and leaves the due date unchanged", () => {
    const db = openDb();
    const before = getTask(3, db)!.dueDate;
    const ext = createExtension(input, db) as { id: number };
    const out = decideExtension(3, ext.id, "rejected", "tanaka", db);
    assert.equal(out.result, "decided");
    assert.equal(getExtension(ext.id, db)!.status, "rejected");
    assert.equal(getExtension(ext.id, db)!.decidedBy, "tanaka");
    assert.equal(getTask(3, db)!.dueDate, before);
  });

  it("rejects: leaves the task's updatedAt unchanged", () => {
    const db = openDb();
    const before = getTask(3, db)!.updatedAt;
    const ext = createExtension(input, db) as { id: number };
    decideExtension(3, ext.id, "rejected", "tanaka", db, new Date("2026-11-10T00:00:00.000Z"));
    assert.equal(getTask(3, db)!.updatedAt, before);
  });

  it("returns not_found for an unknown extension or one of another task", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    assert.deepEqual(decideExtension(3, 999, "approved", "sato", db), { result: "not_found" });
    assert.deepEqual(decideExtension(4, ext.id, "approved", "sato", db), { result: "not_found" });
  });

  it("returns conflict when already decided, without changing the task", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    decideExtension(3, ext.id, "rejected", "sato", db);
    assert.deepEqual(decideExtension(3, ext.id, "approved", "sato", db), { result: "conflict" });
    assert.notEqual(getTask(3, db)!.dueDate, "2026-11-20");
  });

  it("conflict leaves the task's updatedAt unchanged", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    decideExtension(3, ext.id, "rejected", "sato", db);
    const before = getTask(3, db)!.updatedAt;
    decideExtension(3, ext.id, "approved", "sato", db, new Date("2026-11-10T00:00:00.000Z"));
    assert.equal(getTask(3, db)!.updatedAt, before);
  });
});

describe("withdrawExtension", () => {
  it("lets the requester withdraw a pending extension, which disappears from the list", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    const out = withdrawExtension(3, ext.id, "sato", db);
    assert.equal(out.result, "withdrawn");
    if (out.result !== "withdrawn") return;
    assert.equal(out.extension.id, ext.id);
    assert.equal(out.extension.status, "pending");
    assert.equal(getExtension(ext.id, db), undefined);
    assert.deepEqual(listExtensions(3, db), []);
  });

  it("forbids anyone but the requester, and keeps the extension", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    assert.deepEqual(withdrawExtension(3, ext.id, "suzuki", db), { result: "forbidden" });
    assert.equal(getExtension(ext.id, db)!.status, "pending");
  });

  it("forbids others even when the extension is already decided", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    decideExtension(3, ext.id, "rejected", "suzuki", db);
    assert.deepEqual(withdrawExtension(3, ext.id, "tanaka", db), { result: "forbidden" });
    assert.equal(getExtension(ext.id, db)!.status, "rejected");
  });

  it("returns conflict for approved or rejected extensions, keeping them and the due date", () => {
    const db = openDb();
    const approved = createExtension(input, db) as { id: number };
    decideExtension(3, approved.id, "approved", "suzuki", db);
    assert.deepEqual(withdrawExtension(3, approved.id, "sato", db), { result: "conflict" });
    assert.equal(getExtension(approved.id, db)!.status, "approved");
    assert.equal(getTask(3, db)!.dueDate, "2026-11-20");

    const rejected = createExtension({ ...input, newDueDate: "2026-11-30" }, db) as { id: number };
    decideExtension(3, rejected.id, "rejected", "suzuki", db);
    assert.deepEqual(withdrawExtension(3, rejected.id, "sato", db), { result: "conflict" });
    assert.equal(getExtension(rejected.id, db)!.status, "rejected");
    assert.equal(getTask(3, db)!.dueDate, "2026-11-20");
  });

  it("returns not_found for an unknown extension, one of another task, or one already withdrawn", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    assert.deepEqual(withdrawExtension(3, 999, "sato", db), { result: "not_found" });
    assert.deepEqual(withdrawExtension(4, ext.id, "sato", db), { result: "not_found" });
    assert.equal(getExtension(ext.id, db)!.status, "pending");
    assert.equal(withdrawExtension(3, ext.id, "sato", db).result, "withdrawn");
    assert.deepEqual(withdrawExtension(3, ext.id, "sato", db), { result: "not_found" });
  });

  it("removes only the specified extension", () => {
    const db = openDb();
    const decided = createExtension(input, db) as { id: number };
    decideExtension(3, decided.id, "rejected", "suzuki", db);
    const target = createExtension(input, db) as { id: number };
    const other = createExtension({ ...input, taskId: 4 }, db) as { id: number };
    assert.equal(withdrawExtension(3, target.id, "sato", db).result, "withdrawn");
    assert.deepEqual(listExtensions(3, db).map((e) => e.id), [decided.id]);
    assert.deepEqual(listExtensions(4, db).map((e) => e.id), [other.id]);
  });

  it("allows a new request on the same task after withdrawing", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    withdrawExtension(3, ext.id, "sato", db);
    const again = createExtension({ ...input, newDueDate: "2026-11-25" }, db);
    assert.notEqual(again, "conflict");
    assert.deepEqual(listExtensions(3, db).map((e) => [e.newDueDate, e.status]), [["2026-11-25", "pending"]]);
  });
});

describe("listPendingExtensions", () => {
  it("returns only pending requests, oldest first, with task and requester info", () => {
    const db = openDb();
    createExtension({ ...input, taskId: 4, reason: "後の申請" }, db, new Date("2026-11-09T05:00:00.000Z"));
    createExtension({ ...input, taskId: 3, reason: "先の申請" }, db, new Date("2026-11-09T01:00:00.000Z"));
    const approved = createExtension({ ...input, taskId: 5 }, db)!;
    const rejected = createExtension({ ...input, taskId: 6 }, db)!;
    const withdrawn = createExtension({ ...input, taskId: 7 }, db)!;
    if (approved === "conflict" || rejected === "conflict" || withdrawn === "conflict") throw new Error("setup");
    decideExtension(5, approved.id, "approved", "sato", db);
    decideExtension(6, rejected.id, "rejected", "sato", db);
    withdrawExtension(7, withdrawn.id, "sato", db);

    const rows = listPendingExtensions(db);
    assert.deepEqual(rows.map((r) => r.reason), ["先の申請", "後の申請"]);
    assert.equal(rows[0].taskId, 3);
    assert.equal(rows[0].taskTitle, getTask(3, db)!.title);
    assert.equal(rows[0].currentDueDate, getTask(3, db)!.dueDate);
    assert.equal(rows[0].newDueDate, "2026-11-20");
    assert.equal(rows[0].requester, "sato");
  });

  it("is empty when nothing is pending", () => {
    assert.deepEqual(listPendingExtensions(openDb()), []);
  });
});

describe("formatExtensionRequestedAt", () => {
  it("formats in Japan time as YYYY/MM/DD HH:mm", () => {
    assert.equal(formatExtensionRequestedAt("2026-11-09T03:04:05.000Z"), "2026/11/09 12:04");
    assert.equal(formatExtensionRequestedAt("2026-11-09T15:30:00.000Z"), "2026/11/10 00:30");
  });
});
