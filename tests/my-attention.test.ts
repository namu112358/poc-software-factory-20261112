import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createTask, listTasks, parseDueFilter, DUE_SOON_DAYS, type TaskInput } from "../src/lib/tasks.ts";
import { parseTaskFilter } from "../src/lib/export.ts";
import { createExtension } from "../src/lib/extensions.ts";
import { MY_ATTENTION_LIMIT, countMyDueTasks, limitItems, listExtensionsAwaitingMe, listMyDueTasks, myDueTasksHref } from "../src/lib/my-attention.ts";

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

describe("「対応が必要なもの」の件数の上限（#467）", () => {
  it("決めた件数を超えたら、期限の早い順に先頭の分だけを出し、残りの件数は出していない件数と一致する", () => {
    const db = emptyDb();
    for (let i = 0; i < 8; i++) add(db, `t${i}`, `2026-11-${String(10 + (i % 4)).padStart(2, "0")}`);
    const rows = listMyDueTasks("sato", db, TODAY);
    const { shown, hidden } = limitItems(rows);
    assert.equal(shown.length, MY_ATTENTION_LIMIT);
    assert.equal(hidden, rows.length - MY_ATTENTION_LIMIT);
    assert.deepEqual(shown, rows.slice(0, MY_ATTENTION_LIMIT));
  });

  it("件数が上限以下なら、全部を出し、「ほか」は 0 件", () => {
    for (const n of [0, 1, MY_ATTENTION_LIMIT]) {
      const items = Array.from({ length: n }, (_, i) => i);
      assert.deepEqual(limitItems(items), { shown: items, hidden: 0 });
    }
  });

  it("期限切れと期限間近の内訳を数える", () => {
    const db = emptyDb();
    add(db, "a", "2026-11-01");
    add(db, "b", "2026-11-11");
    add(db, "c", "2026-11-12");
    assert.deepEqual(countMyDueTasks(listMyDueTasks("sato", db, TODAY)), { overdue: 2, dueSoon: 1 });
  });

  it("「ほか N 件」のリンク先の一覧は、完了以外の件数が欄の全件数と一致する（完了・アーカイブ・他人のタスクは数えない）", () => {
    const db = emptyDb();
    for (let i = 0; i < 7; i++) add(db, `o${i}`, `2026-11-${String(1 + i).padStart(2, "0")}`);
    add(db, "今日", TODAY);
    add(db, "3日後", "2026-11-15");
    add(db, "4日後", "2026-11-16");
    add(db, "完了", "2026-11-10", { status: "done" });
    add(db, "他人", "2026-11-10", { assignee: "suzuki" });
    const href = myDueTasksHref("sato");
    const q = new URLSearchParams(href.split("?")[1]);
    assert.equal(q.get("assignee"), "sato");
    const filter = { assignees: q.getAll("assignee"), due: parseDueFilter(q.get("due")), today: TODAY };
    const listed = listTasks(filter, db).filter((t) => t.status !== "done");
    assert.equal(listed.length, listMyDueTasks("sato", db, TODAY).length);
    assert.equal(listed.length, 9);
  });

  it("延長の承認待ちも上限を超えたら「ほか N 件」になる", () => {
    const db = emptyDb();
    for (let i = 0; i < MY_ATTENTION_LIMIT + 2; i++) {
      const t = add(db, `x${i}`, "2026-11-10");
      createExtension({ taskId: t.id, requester: "suzuki", newDueDate: "2026-11-20", reason: "r" }, db);
    }
    const { shown, hidden } = limitItems(listExtensionsAwaitingMe("tanaka", db));
    assert.equal(shown.length, MY_ATTENTION_LIMIT);
    assert.equal(hidden, 2);
  });
});

describe("期限の絞り込み「3 日以内」（soon）", () => {
  it("期限切れと今日から DUE_SOON_DAYS 日後までが入り、その翌日以降は入らない。期限なしは入らない", () => {
    const db = emptyDb();
    add(db, "先月", "2026-10-01");
    add(db, "今日", TODAY);
    add(db, "3日後", "2026-11-15");
    add(db, "4日後", "2026-11-16");
    assert.equal(DUE_SOON_DAYS, 3);
    assert.deepEqual(listTasks({ due: "soon", today: TODAY }, db).map((t) => t.title).sort(), ["3日後", "今日", "先月"]);
  });

  it("画面・CSV・API が使う検証で受け付ける。不正な値は指定なし", () => {
    assert.equal(parseDueFilter("soon"), "soon");
    assert.equal(parseTaskFilter(new URLSearchParams("due=soon"), openDb()).due, "soon");
    assert.equal(parseDueFilter("soonish"), undefined);
  });
});
