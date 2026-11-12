import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createTask, type TaskInput } from "../src/lib/tasks.ts";
import { createExtension } from "../src/lib/extensions.ts";
import { listExtensionsAwaitingMe, listMyDueTasks } from "../src/lib/my-attention.ts";

const TODAY = "2026-11-12";

function emptyDb() {
  const db = openDb();
  db.prepare("DELETE FROM tasks").run();
  return db;
}

function add(db: ReturnType<typeof openDb>, title: string, dueDate: string, extra: Partial<TaskInput> = {}) {
  return createTask({ title, status: "todo", assignee: "sato", dueDate, priority: "medium", estimateMinutes: null, memo: "", ...extra }, db);
}

describe("listMyDueTasks", () => {
  it("lists my overdue and due-soon (within 3 days) tasks, nearest due date first", () => {
    const db = emptyDb();
    add(db, "3日後", "2026-11-15");
    add(db, "昨日", "2026-11-11");
    add(db, "今日", "2026-11-12");
    add(db, "4日後", "2026-11-16");
    add(db, "先月", "2026-10-01");
    const rows = listMyDueTasks("sato", db, TODAY);
    assert.deepEqual(
      rows.map((r) => [r.title, r.kind]),
      [["先月", "overdue"], ["昨日", "overdue"], ["今日", "due-soon"], ["3日後", "due-soon"]],
    );
  });

  it("excludes done, archived, and other people's tasks", () => {
    const db = emptyDb();
    add(db, "完了", "2026-11-10", { status: "done" });
    add(db, "アーカイブ", "2026-11-10", { archived: true });
    add(db, "他人", "2026-11-10", { assignee: "suzuki" });
    add(db, "自分", "2026-11-10");
    assert.deepEqual(listMyDueTasks("sato", db, TODAY).map((r) => r.title), ["自分"]);
  });

  it("returns nothing when there is no matching task", () => {
    assert.deepEqual(listMyDueTasks("sato", emptyDb(), TODAY), []);
  });
});

describe("listExtensionsAwaitingMe", () => {
  it("取りまとめる人には、ほかの人が出した承認待ちを出し、自分の申請・判断済みは出さない", () => {
    const db = emptyDb();
    const t = add(db, "対象", "2026-11-10");
    const t2 = add(db, "対象2", "2026-11-10");
    const t3 = add(db, "判断済み", "2026-11-10");
    createExtension({ taskId: t.id, requester: "suzuki", newDueDate: "2026-11-20", reason: "r" }, db);
    createExtension({ taskId: t2.id, requester: "tanaka", newDueDate: "2026-11-20", reason: "r" }, db);
    const decided = createExtension({ taskId: t3.id, requester: "sato", newDueDate: "2026-11-20", reason: "r" }, db);
    db.prepare("UPDATE due_date_extensions SET status = 'rejected', decided_by = 'tanaka' WHERE id = ?").run((decided as { id: number }).id);
    assert.deepEqual(listExtensionsAwaitingMe("tanaka", db).map((r) => r.taskId), [t.id]);
  });

  it("取りまとめる人でなければ、ほかの人の承認待ちがあっても何も出さない", () => {
    const db = emptyDb();
    const t = add(db, "対象", "2026-11-10");
    const t2 = add(db, "対象2", "2026-11-10");
    createExtension({ taskId: t.id, requester: "suzuki", newDueDate: "2026-11-20", reason: "r" }, db);
    createExtension({ taskId: t2.id, requester: "tanaka", newDueDate: "2026-11-20", reason: "r" }, db);
    assert.deepEqual(listExtensionsAwaitingMe("sato", db), []);
    assert.deepEqual(listExtensionsAwaitingMe("suzuki", db), []);
    assert.deepEqual(listExtensionsAwaitingMe("unknown", db), []);
  });
});
