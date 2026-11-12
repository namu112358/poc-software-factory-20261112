import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { raisePriority } from "../src/lib/priority-raise.ts";
import { createTask, getTask, type TaskPriority } from "../src/lib/tasks.ts";

function taskWith(db: ReturnType<typeof openDb>, priority: TaskPriority) {
  return createTask({ title: "テスト", status: "todo", assignee: "sato", dueDate: "2026-12-01", priority }, db);
}

describe("raisePriority", () => {
  it("raises low to medium", () => {
    const db = openDb();
    const t = taskWith(db, "low");
    const r = raisePriority(t.id, db);
    assert.ok(r.ok && r.task.priority === "medium");
    assert.equal(getTask(t.id, db)!.priority, "medium");
  });

  it("raises medium to high and returns the task in the same shape as getTask", () => {
    const db = openDb();
    const t = taskWith(db, "medium");
    const r = raisePriority(t.id, db);
    assert.ok(r.ok);
    assert.deepEqual(r.task, getTask(t.id, db));
    assert.equal(r.task.priority, "high");
  });

  it("refuses a high task and leaves it unchanged", () => {
    const db = openDb();
    const t = taskWith(db, "high");
    const r = raisePriority(t.id, db);
    assert.deepEqual(r, { ok: false, reason: "already_highest" });
    assert.deepEqual(getTask(t.id, db), t);
  });

  it("reports a missing task", () => {
    assert.deepEqual(raisePriority(99999, openDb()), { ok: false, reason: "not_found" });
  });

  it("raises only one step per call and does not touch other tasks", () => {
    const db = openDb();
    const a = taskWith(db, "low");
    const b = taskWith(db, "low");
    raisePriority(a.id, db);
    assert.equal(getTask(a.id, db)!.priority, "medium");
    assert.equal(getTask(b.id, db)!.priority, "low");
  });
});
