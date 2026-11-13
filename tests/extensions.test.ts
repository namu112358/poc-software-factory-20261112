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
import type { Db } from "../src/lib/db/index.ts";

const input = { taskId: 3, requester: "sato", newDueDate: "2026-11-20", reason: "レビュー待ちのため" };

describe("validateExtensionInput", () => {
  it("accepts a valid date and a 1-500 character reason (trimmed)", () => {
    assert.deepEqual(validateExtensionInput({ newDueDate: "2026-11-20", reason: " 理由 " }, "2026-11-10"), {
      ok: true,
      value: { newDueDate: "2026-11-20", reason: "理由" },
    });
    assert.equal(validateExtensionInput({ newDueDate: "2026-11-20", reason: "a".repeat(500) }, "2026-11-10").ok, true);
  });

  it("rejects bad dates", () => {
    for (const newDueDate of ["2026/11/20", "2026-1-2", "2026-02-30", "2026-13-01", "", 20261120, null, undefined]) {
      assert.equal(validateExtensionInput({ newDueDate, reason: "x" }, "2026-11-10").ok, false, String(newDueDate));
    }
  });

  it("rejects bad reasons and non-object bodies", () => {
    for (const reason of ["", "  ", "a".repeat(501), 1, null, undefined]) {
      assert.equal(validateExtensionInput({ newDueDate: "2026-11-20", reason }, "2026-11-10").ok, false, String(reason));
    }
    for (const body of [null, undefined, "x", []]) assert.equal(validateExtensionInput(body, "2026-11-10").ok, false);
  });
});

describe("validateExtensionInput: 今の期限との比べ", () => {
  const ok = (newDueDate: string, due: string) => validateExtensionInput({ newDueDate, reason: "x" }, due).ok;
  it("rejects a date before or equal to the current due date, accepts a later one", () => {
    assert.equal(ok("2026-11-10", "2026-11-20"), false);
    assert.equal(ok("2026-11-20", "2026-11-20"), false);
    assert.equal(ok("2026-11-21", "2026-11-20"), true);
    assert.equal(ok("2027-01-01", "2026-12-31"), true); // 月・年をまたぐ
  });
  it("explains what to do", () => {
    const r = validateExtensionInput({ newDueDate: "2026-11-10", reason: "x" }, "2026-11-20");
    assert.deepEqual(r, { ok: false, errors: ["希望の期限は、今の期限より後の日付にしてください"] });
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
    decideExtension(3, first.id, "rejected", "tanaka", db);
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
    const out = decideExtension(3, ext.id, "approved", "tanaka", db, new Date("2026-11-10T00:00:00.000Z"));
    assert.equal(out.result, "decided");
    if (out.result !== "decided") return;
    assert.equal(out.extension.status, "approved");
    assert.equal(out.extension.decidedBy, "tanaka");
    assert.equal(out.extension.decidedAt, "2026-11-10T00:00:00.000Z");
    assert.equal(out.task.dueDate, "2026-11-20");
    assert.equal(getTask(3, db)!.dueDate, "2026-11-20");
  });

  it("approves: sets the task's updatedAt to the decision time", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    const now = new Date("2026-11-10T00:00:00.000Z");
    assert.notEqual(getTask(3, db)!.updatedAt, now.toISOString());
    decideExtension(3, ext.id, "approved", "tanaka", db, now);
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
    decideExtension(3, ext.id, "rejected", "tanaka", db);
    assert.deepEqual(decideExtension(3, ext.id, "approved", "tanaka", db), { result: "conflict" });
    assert.notEqual(getTask(3, db)!.dueDate, "2026-11-20");
  });

  it("conflict leaves the task's updatedAt unchanged", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    decideExtension(3, ext.id, "rejected", "tanaka", db);
    const before = getTask(3, db)!.updatedAt;
    decideExtension(3, ext.id, "approved", "tanaka", db, new Date("2026-11-10T00:00:00.000Z"));
    assert.equal(getTask(3, db)!.updatedAt, before);
  });
});

describe("decideExtension: 申請した本人は判断できない", () => {
  for (const decision of ["approved", "rejected"] as const) {
    it(`本人が ${decision} しようとすると forbidden で、申請・期限・最終更新日時は変わらない`, () => {
      const db = openDb();
      const ext = createExtension(input, db) as { id: number };
      const taskBefore = getTask(3, db);
      const extBefore = getExtension(ext.id, db);
      assert.deepEqual(decideExtension(3, ext.id, decision, "sato", db, new Date("2026-11-10T00:00:00.000Z")), {
        result: "forbidden",
        reason: "own",
      });
      assert.deepEqual(getTask(3, db), taskBefore);
      assert.deepEqual(getExtension(ext.id, db), extBefore);
    });
  }

  it("本人の申請がすでに判断済みでも forbidden（本人の判定が判断済みより先）", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    decideExtension(3, ext.id, "rejected", "tanaka", db);
    assert.deepEqual(decideExtension(3, ext.id, "approved", "sato", db), { result: "forbidden", reason: "own" });
  });

  it("申請が無い・別のタスクの申請なら、本人でも not_found（無いことの判定が本人より先）", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    assert.deepEqual(decideExtension(4, ext.id, "approved", "sato", db), { result: "not_found" });
  });

  it("本人以外の取りまとめる人なら、タスクの担当者でも判断できる", () => {
    const db = openDb();
    db.prepare("UPDATE users SET role = 'coordinator' WHERE id = 'sato'").run();
    const ext = createExtension({ ...input, requester: "tanaka" }, db) as { id: number };
    assert.equal(decideExtension(3, ext.id, "approved", "sato", db).result, "decided");
  });
});

describe("decideExtension: 確かめてから書き込むまでに、ほかの人が判断していたとき", () => {
  /**
   * 判断済みかを確かめた後、トランザクションを始める直前に、ほかの人（別の接続）の却下を割り込ませる DB。
   * メソッドは元の DB に結び付けて返す。
   */
  function racyDb(db: Db, extensionId: number): { db: Db; interleaved: () => boolean } {
    let interleaved = false;
    const proxy = new Proxy(db, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (prop !== "exec") return typeof value === "function" ? value.bind(target) : value;
        return (sql: string) => {
          if (!interleaved && sql === "BEGIN") {
            interleaved = true;
            target
              .prepare("UPDATE due_date_extensions SET status = 'rejected', decided_by = 'tanaka' WHERE id = ?")
              .run(extensionId);
          }
          return target.exec(sql);
        };
      },
    }) as Db;
    return { db: proxy, interleaved: () => interleaved };
  }

  it("承認は conflict になり、タスクの期限・最終更新日時は変わらず、先の判断が残る", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    const taskBefore = getTask(3, db);
    const racy = racyDb(db, ext.id);
    db.prepare("UPDATE users SET role = 'coordinator' WHERE id = 'suzuki'").run();
    assert.deepEqual(decideExtension(3, ext.id, "approved", "suzuki", racy.db), { result: "conflict" });
    assert.ok(racy.interleaved());
    assert.deepEqual(getTask(3, db), taskBefore);
    assert.equal(getExtension(ext.id, db)!.status, "rejected");
    assert.equal(getExtension(ext.id, db)!.decidedBy, "tanaka");
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
    assert.deepEqual(withdrawExtension(3, ext.id, "tanaka", db), { result: "forbidden" });
    assert.equal(getExtension(ext.id, db)!.status, "pending");
  });

  it("forbids others even when the extension is already decided", () => {
    const db = openDb();
    const ext = createExtension(input, db) as { id: number };
    decideExtension(3, ext.id, "rejected", "tanaka", db);
    assert.deepEqual(withdrawExtension(3, ext.id, "tanaka", db), { result: "forbidden" });
    assert.equal(getExtension(ext.id, db)!.status, "rejected");
  });

  it("returns conflict for approved or rejected extensions, keeping them and the due date", () => {
    const db = openDb();
    const approved = createExtension(input, db) as { id: number };
    decideExtension(3, approved.id, "approved", "tanaka", db);
    assert.deepEqual(withdrawExtension(3, approved.id, "sato", db), { result: "conflict" });
    assert.equal(getExtension(approved.id, db)!.status, "approved");
    assert.equal(getTask(3, db)!.dueDate, "2026-11-20");

    const rejected = createExtension({ ...input, newDueDate: "2026-11-30" }, db) as { id: number };
    decideExtension(3, rejected.id, "rejected", "tanaka", db);
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
    decideExtension(3, decided.id, "rejected", "tanaka", db);
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
    decideExtension(5, approved.id, "approved", "tanaka", db);
    decideExtension(6, rejected.id, "rejected", "tanaka", db);
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
