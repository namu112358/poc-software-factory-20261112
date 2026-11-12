import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createTask, updateTask } from "../src/lib/tasks.ts";
import { listOverdueTasks } from "../src/lib/overdue.ts";
import { listMemberWorkload } from "../src/lib/members.ts";
import { addTag, listTagCounts } from "../src/lib/tags.ts";
import { exportTasksCsv } from "../src/lib/export.ts";
import { listBoard } from "../src/lib/board.ts";
import { countTasksByStatus } from "../src/lib/task-count.ts";

const TODAY = "2026-11-12";

function setup() {
  const db = openDb();
  db.prepare("DELETE FROM tasks").run();
  const task = createTask({ title: "やめた作業", status: "todo", assignee: "sato", dueDate: "2026-11-01", priority: "medium", estimateMinutes: 30, memo: "" }, db);
  addTag(task.id, "急ぎ", db);
  return { db, id: task.id };
}

describe("アーカイブしたタスクの除外（期限切れ・担当者ごと・タグ・CSV・かんばん・件数）", () => {
  it("アーカイブすると、どの画面・集計にも出ず、戻すと再び出る", () => {
    const { db, id } = setup();
    const snapshot = () => ({
      overdue: listOverdueTasks(db, TODAY).map((r) => r.id),
      member: listMemberWorkload(db).find((m) => m.id === "sato")!.openCount,
      tag: listTagCounts(db).length,
      csv: exportTasksCsv({}, db).includes("やめた作業"),
      board: listBoard(db).reduce((n, r) => n + r.count, 0),
      count: Object.values(countTasksByStatus(db)).reduce((a, b) => a + b, 0),
    });
    assert.deepEqual(snapshot(), { overdue: [id], member: 1, tag: 1, csv: true, board: 1, count: 1 });
    updateTask(id, { archived: true }, db);
    assert.deepEqual(snapshot(), { overdue: [], member: 0, tag: 0, csv: false, board: 0, count: 0 });
    updateTask(id, { archived: false }, db);
    assert.deepEqual(snapshot(), { overdue: [id], member: 1, tag: 1, csv: true, board: 1, count: 1 });
  });
});
