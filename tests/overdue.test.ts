import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createTask, type TaskInput } from "../src/lib/tasks.ts";
import { daysOverdue, listOverdueTasks } from "../src/lib/overdue.ts";

const TODAY = "2026-11-12";

function add(db: ReturnType<typeof openDb>, title: string, dueDate: string, status: TaskInput["status"], assignee = "sato") {
  return createTask({ title, status, assignee, dueDate, priority: "medium", estimateMinutes: null, memo: "" }, db);
}

function emptyDb() {
  const db = openDb();
  db.prepare("DELETE FROM tasks").run();
  return db;
}

describe("daysOverdue", () => {
  it("counts calendar days, including across month and year ends", () => {
    assert.equal(daysOverdue("2026-11-09", TODAY), 3);
    assert.equal(daysOverdue("2026-11-11", TODAY), 1);
    assert.equal(daysOverdue("2025-12-31", "2026-01-02"), 2);
  });
});

describe("listOverdueTasks", () => {
  it("lists only unfinished tasks whose due date is before today (today itself is not overdue)", () => {
    const db = emptyDb();
    add(db, "昨日・未着手", "2026-11-11", "todo");
    add(db, "昨日・進行中", "2026-11-11", "in_progress");
    add(db, "昨日・完了", "2026-11-11", "done");
    add(db, "今日まで", "2026-11-12", "todo");
    add(db, "明日", "2026-11-13", "todo");
    assert.deepEqual(listOverdueTasks(db, TODAY).map((r) => r.title), ["昨日・未着手", "昨日・進行中"]);
  });

  it("returns title, assignee name, due date and 'N 日超過' for each row", () => {
    const db = emptyDb();
    const t = add(db, "遅れ", "2026-11-09", "todo", "suzuki");
    const [row] = listOverdueTasks(db, TODAY);
    assert.equal(row.id, t.id);
    assert.equal(row.title, "遅れ");
    assert.equal(row.assigneeName, "鈴木");
    assert.equal(row.dueDate, "2026-11-09");
    assert.equal(row.label, "3 日超過");
  });

  it("sorts by days overdue, largest first (ties by id)", () => {
    const db = emptyDb();
    add(db, "1 日", "2026-11-11", "todo");
    add(db, "10 日", "2026-11-02", "todo");
    add(db, "3 日 A", "2026-11-09", "todo");
    add(db, "3 日 B", "2026-11-09", "todo");
    assert.deepEqual(listOverdueTasks(db, TODAY).map((r) => r.title), ["10 日", "3 日 A", "3 日 B", "1 日"]);
  });

  it("returns an empty list when nothing is overdue", () => {
    const db = emptyDb();
    add(db, "未来", "2026-12-01", "todo");
    assert.deepEqual(listOverdueTasks(db, TODAY), []);
  });
});
