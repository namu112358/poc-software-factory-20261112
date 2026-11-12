import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createExtension, decideExtension, getExtension, listExtensions, validateExtensionInput } from "../src/lib/extensions.ts";
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
});
