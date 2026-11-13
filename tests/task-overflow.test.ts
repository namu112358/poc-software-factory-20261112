import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { listBoard } from "../src/lib/board.ts";
import { listMemberWorkload } from "../src/lib/members.ts";
import { createTask, listTasks } from "../src/lib/tasks.ts";
import { VISIBLE_TASK_LIMIT, boardMoreHref, memberMoreHref, splitVisible } from "../src/lib/task-overflow.ts";

describe("splitVisible", () => {
  it("limit 以下なら全部出し、ほか N 件は 0", () => {
    assert.deepEqual(splitVisible([1, 2, 3, 4, 5], 5), { shown: [1, 2, 3, 4, 5], hiddenCount: 0 });
    assert.deepEqual(splitVisible([], 5), { shown: [], hiddenCount: 0 });
  });
  it("limit を超えたら先頭の limit 件と、残りの件数", () => {
    assert.deepEqual(splitVisible([1, 2, 3, 4, 5, 6, 7], 5), { shown: [1, 2, 3, 4, 5], hiddenCount: 2 });
  });
});

describe("ボードの「ほか N 件」", () => {
  it("出した件数 + N = 欄の件数で、リンク先の一覧の件数と欄の件数が一致する", () => {
    const db = openDb();
    for (let i = 0; i < 9; i++) createTask({ title: `請求書の確認（${i} 月分）`, status: "todo", assignee: "sato", dueDate: "2099-01-01" }, db);
    const todo = listBoard(db)[0];
    const { shown, hiddenCount } = splitVisible(todo.tasks);
    assert.equal(shown.length, VISIBLE_TASK_LIMIT);
    assert.equal(shown.length + hiddenCount, todo.count);
    assert.equal(todo.count, 12);
    const query = new URL(boardMoreHref(todo.status), "http://x").searchParams.get("status");
    assert.equal(listTasks({ status: query as "todo" }, db).length, todo.count);
  });
});

describe("メンバーの「ほか N 件」", () => {
  it("件数は全件を数え、担当者で絞った一覧に当該のタスクがすべて含まれる（タスクを持たない人は出さない）", () => {
    const db = openDb();
    for (let i = 0; i < 8; i++) createTask({ title: `タスク${i}`, status: "in_progress", assignee: "sato", dueDate: "2099-01-01" }, db);
    const m = listMemberWorkload(db).find((x) => x.id === "sato")!;
    const { shown, hiddenCount } = splitVisible(m.tasks);
    assert.equal(shown.length + hiddenCount, m.openCount);
    const id = new URL(memberMoreHref("sato"), "http://x").searchParams.get("assignee")!;
    const listed = listTasks({ assignees: [id] }, db).map((t) => t.id);
    for (const t of m.tasks) assert.ok(listed.includes(t.id));
  });
});
