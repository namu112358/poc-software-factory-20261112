import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { countTasksByStatus } from "../src/lib/task-count.ts";
import { createTask, listTasks, updateTask } from "../src/lib/tasks.ts";

/** タスクが 1 件も無く、担当者になれるユーザー（sato・suzuki）だけがいる DB。 */
function emptyDb() {
  const db = openDb(":memory:", { seed: false });
  db.prepare("INSERT INTO users (id, name, password_hash) VALUES ('sato', '佐藤', 'x'), ('suzuki', '鈴木', 'x')").run();
  return db;
}

// GET /api/task-count（src/app/api/task-count/route.ts）は、ログインを確かめた後にこの関数の結果をそのまま返す。
// ルートは next/server を読み込むため単体テストから呼べない。200・401 の応答は手動確認で確かめた。
describe("ステータスごとのタスク数", () => {
  it("todo・in_progress・done の 3 つのキーだけを、数値で返す", () => {
    const counts = countTasksByStatus(openDb());
    assert.deepEqual(Object.keys(counts).sort(), ["done", "in_progress", "todo"]);
    for (const n of Object.values(counts)) assert.equal(typeof n, "number");
  });

  it("各ステータスの件数が、アーカイブしていないタスクの件数と一致する", () => {
    const db = openDb();
    const tasks = listTasks({}, db);
    assert.deepEqual(countTasksByStatus(db), {
      todo: tasks.filter((t) => t.status === "todo").length,
      in_progress: tasks.filter((t) => t.status === "in_progress").length,
      done: tasks.filter((t) => t.status === "done").length,
    });
  });

  it("タスクが 1 件も無いときは、3 つとも 0", () => {
    assert.deepEqual(countTasksByStatus(openDb(":memory:", { seed: false })), { todo: 0, in_progress: 0, done: 0 });
  });

  it("0 件のステータスもキーを省かず 0 で返す", () => {
    const db = emptyDb();
    createTask({ title: "a", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    createTask({ title: "b", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    assert.deepEqual(countTasksByStatus(db), { todo: 2, in_progress: 0, done: 0 });
  });

  it("アーカイブしたタスクはどのステータスでも数えず、戻すと再び数える", () => {
    const db = emptyDb();
    const a = createTask({ title: "a", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    const b = createTask({ title: "b", status: "in_progress", assignee: "sato", dueDate: "2026-12-01" }, db);
    const c = createTask({ title: "c", status: "done", assignee: "sato", dueDate: "2026-12-01" }, db);
    for (const t of [a, b, c]) updateTask(t.id, { archived: true }, db);
    assert.deepEqual(countTasksByStatus(db), { todo: 0, in_progress: 0, done: 0 });
    updateTask(b.id, { archived: false }, db);
    assert.deepEqual(countTasksByStatus(db), { todo: 0, in_progress: 1, done: 0 });
  });

  it("担当者に関係なく、全員のタスクを数える", () => {
    const db = emptyDb();
    createTask({ title: "a", status: "done", assignee: "sato", dueDate: "2026-12-01" }, db);
    createTask({ title: "b", status: "done", assignee: "suzuki", dueDate: "2026-12-01" }, db);
    assert.equal(countTasksByStatus(db).done, 2);
  });
});
