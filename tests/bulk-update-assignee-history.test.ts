import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { formatAssigneeChange, listAssigneeChanges } from "../src/lib/assignee-history.ts";
import { updateTasks, validateBulkUpdateInput } from "../src/lib/bulk-update.ts";
import { getTask, updateTask } from "../src/lib/tasks.ts";

// まとめて替えたときの担当者の変更の履歴（#340）。
// 初期データの担当者: 1 sato、2 suzuki、3 sato、4 tanaka、5 suzuki、6 sato、7 tanaka。

function count(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM task_assignee_changes").get() as { n: number }).n;
}

describe("まとめて担当者を替えたときの履歴", () => {
  it("3 件の担当者をまとめて替えると、それぞれに変更前・変更後・変更した人・日時が 1 件ずつ残る", () => {
    const db = openDb();
    const result = updateTasks([2, 4, 5], { assignee: "sato" }, db, "tanaka"); // suzuki・tanaka・suzuki → sato
    assert.ok(result.ok);
    assert.equal(count(db), 3);
    const expectedFrom: Record<number, string> = { 2: "suzuki", 4: "tanaka", 5: "suzuki" };
    for (const task of result.tasks) {
      const changes = listAssigneeChanges(task.id, db);
      assert.equal(changes.length, 1, `task ${task.id}`);
      const [c] = changes;
      assert.equal(c.fromAssignee, expectedFrom[task.id]);
      assert.equal(c.toAssignee, "sato");
      assert.equal(c.changedBy, "tanaka");
      assert.match(c.changedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(c.changedAt, task.updatedAt);
    }
  });

  it("すでに同じ担当者だったタスクには履歴を足さない", () => {
    const db = openDb();
    const result = updateTasks([1, 2, 3], { assignee: "sato" }, db, "tanaka"); // 1・3 はもう sato
    assert.ok(result.ok);
    assert.deepEqual(listAssigneeChanges(1, db), []);
    assert.deepEqual(listAssigneeChanges(3, db), []);
    assert.equal(listAssigneeChanges(2, db).length, 1);
    assert.equal(count(db), 1);
  });

  it("ステータスだけをまとめて変えたときは履歴を足さない", () => {
    const db = openDb();
    const result = updateTasks([2, 4, 5], { status: "done" }, db, "tanaka");
    assert.ok(result.ok);
    assert.equal(count(db), 0);
  });

  it("担当者とステータスを一緒に変えたとき、担当者が替わったタスクにだけ履歴を足す", () => {
    const db = openDb();
    const result = updateTasks([2, 4], { status: "done", assignee: "suzuki" }, db, "sato"); // 2 は担当者がもう suzuki
    assert.ok(result.ok);
    assert.deepEqual(listAssigneeChanges(2, db), []);
    const [c] = listAssigneeChanges(4, db);
    assert.deepEqual([c.fromAssignee, c.toAssignee, c.changedBy], ["tanaka", "suzuki", "sato"]);
    assert.equal(count(db), 1);
  });

  it("存在しない ID があって何も変えないときは、履歴も 1 件も足さない", () => {
    const db = openDb();
    const result = updateTasks([2, 999, 4], { assignee: "sato" }, db, "tanaka");
    assert.deepEqual(result, { ok: false, missingIds: [999] });
    assert.equal(count(db), 0);
  });

  it("途中のタスクの更新で失敗したら、それまでに足した履歴も残らない", () => {
    const db = openDb();
    db.exec("CREATE TRIGGER fail_on_5 BEFORE UPDATE ON tasks WHEN NEW.id = 5 BEGIN SELECT RAISE(ABORT, 'boom'); END");
    assert.throws(() => updateTasks([2, 4, 5], { assignee: "sato" }, db, "tanaka"));
    assert.equal(count(db), 0);
    assert.equal(getTask(2, db)?.assignee, "suzuki");
    assert.equal(getTask(4, db)?.assignee, "tanaka");
  });

  it("履歴を足すところで失敗したら、タスクの担当者も戻す", () => {
    const db = openDb();
    db.exec(
      "CREATE TRIGGER fail_history_on_5 BEFORE INSERT ON task_assignee_changes WHEN NEW.task_id = 5 BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    assert.throws(() => updateTasks([2, 4, 5], { assignee: "sato" }, db, "tanaka"));
    assert.equal(count(db), 0);
    assert.deepEqual(
      [2, 4, 5].map((id) => getTask(id, db)?.assignee),
      ["suzuki", "tanaka", "suzuki"],
    );
  });

  it("入力に誤りがあるときは更新に進まないので、履歴は足さない", () => {
    const db = openDb();
    const input = validateBulkUpdateInput({ ids: [2, 4], changes: { assignee: "nobody" } }, db);
    assert.equal(input.ok, false);
    assert.equal(count(db), 0);
  });

  it("指定しなかったタスクの履歴は増えない", () => {
    const db = openDb();
    updateTasks([2], { assignee: "sato" }, db, "tanaka");
    for (const id of [1, 3, 4, 5, 6, 7]) assert.deepEqual(listAssigneeChanges(id, db), [], `task ${id}`);
  });

  it("詳細画面の「担当者の履歴」に、1 件ずつ替えた分と並んで、まとめて替えた分も出る", () => {
    const db = openDb();
    updateTask(4, { assignee: "suzuki" }, db, "sato"); // 1 件ずつ: tanaka → suzuki
    updateTasks([4, 5], { assignee: "sato" }, db, "tanaka"); // まとめて: suzuki → sato
    const changes = listAssigneeChanges(4, db);
    assert.deepEqual(
      changes.map((c) => [c.fromAssignee, c.toAssignee, c.changedBy]),
      [
        ["suzuki", "sato", "tanaka"],
        ["tanaka", "suzuki", "sato"],
      ],
    );
    assert.match(formatAssigneeChange(changes[0]), / 田中 が 鈴木 → 佐藤 に変更$/);
  });
});
