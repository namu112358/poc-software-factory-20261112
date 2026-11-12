import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { listBoard, shortenTitle } from "../src/lib/board.ts";
import { createTask } from "../src/lib/tasks.ts";

describe("shortenTitle", () => {
  it("keeps titles of 10 characters or fewer and cuts longer ones with …", () => {
    assert.equal(shortenTitle("a".repeat(10)), "a".repeat(10));
    assert.equal(shortenTitle("a".repeat(11)), "a".repeat(10) + "…");
    assert.equal(shortenTitle("🔥".repeat(10)), "🔥".repeat(10));
    assert.equal(shortenTitle("🔥".repeat(11)), "🔥".repeat(10) + "…");
    assert.equal(shortenTitle(""), "");
  });
});

describe("listBoard", () => {
  it("returns todo, in_progress, done in order with Japanese labels", () => {
    const rows = listBoard(openDb());
    assert.deepEqual(rows.map((r) => r.status), ["todo", "in_progress", "done"]);
    assert.deepEqual(rows.map((r) => r.label), ["未着手", "進行中", "完了"]);
  });

  it("counts match the seed data (3 / 2 / 2) and equal the task list length", () => {
    const rows = listBoard(openDb());
    assert.deepEqual(rows.map((r) => r.count), [3, 2, 2]);
    for (const r of rows) assert.equal(r.tasks.length, r.count);
  });

  it("sorts tasks by due date ascending, ties by id, and shows all of them", () => {
    const db = openDb();
    const base = { status: "todo" as const, assignee: "sato", priority: "medium" as const };
    const late = createTask({ ...base, title: "遅い", dueDate: "2099-12-31" }, db);
    const early1 = createTask({ ...base, title: "早い1", dueDate: "2000-01-01" }, db);
    const early2 = createTask({ ...base, title: "早い2", dueDate: "2000-01-01" }, db);
    const todo = listBoard(db)[0];
    assert.equal(todo.count, 6);
    const ids = todo.tasks.map((t) => t.id);
    assert.deepEqual(ids.slice(0, 2), [early1.id, early2.id]);
    assert.equal(ids[ids.length - 1], late.id);
  });

  it("shortens only the displayed title; id and full title stay", () => {
    const db = openDb();
    const t = createTask({ title: "あ".repeat(12), status: "done", assignee: "sato", dueDate: "2000-01-01", priority: "low" }, db);
    const task = listBoard(db)[2].tasks.find((x) => x.id === t.id);
    assert.equal(task?.shortTitle, "あ".repeat(10) + "…");
    assert.equal(task?.title, "あ".repeat(12));
  });

  it("shows count 0 and no tasks for an empty status", () => {
    const db = openDb();
    db.exec("DELETE FROM tasks WHERE status = 'in_progress'");
    const row = listBoard(db)[1];
    assert.equal(row.count, 0);
    assert.deepEqual(row.tasks, []);
  });
});
