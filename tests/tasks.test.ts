import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import {
  createTask,
  getTask,
  isTaskStatus,
  listTasks,
  parseTaskId,
  updateTask,
  validateTaskInput,
} from "../src/lib/tasks.ts";

describe("listTasks", () => {
  it("returns all tasks without a filter", () => {
    assert.equal(listTasks({}, openDb()).length, 7);
  });

  it("filters by status", () => {
    const tasks = listTasks({ status: "todo" }, openDb());
    assert.ok(tasks.length > 0);
    assert.ok(tasks.every((t) => t.status === "todo"));
  });
});

describe("getTask", () => {
  it("returns a task by id, or undefined", () => {
    const db = openDb();
    assert.deepEqual(getTask(1, db), {
      id: 1,
      title: "要件定義書のレビュー",
      status: "done",
      assignee: "sato",
      dueDate: "2026-11-02",
    });
    assert.equal(getTask(999, db), undefined);
  });
});

describe("parseTaskId", () => {
  it("accepts positive integers only", () => {
    assert.equal(parseTaskId("3"), 3);
    for (const bad of ["0", "-1", "1.5", "abc", "", "01", undefined]) assert.equal(parseTaskId(bad), undefined, String(bad));
  });
});

describe("validateTaskInput", () => {
  const valid = { title: " 新しいタスク ", status: "todo", assignee: "tanaka", dueDate: "2026-12-01" };

  it("accepts a complete input and trims the title", () => {
    const r = validateTaskInput(valid, {}, openDb());
    assert.deepEqual(r, { ok: true, value: { ...valid, title: "新しいタスク" } });
  });

  it("reports every invalid field", () => {
    const r = validateTaskInput({ title: "", status: "x", assignee: "nobody", dueDate: "12/01" }, {}, openDb());
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.errors.length, 4);
  });

  it("rejects non-object bodies", () => {
    for (const body of [undefined, null, "x", []]) assert.equal(validateTaskInput(body, {}, openDb()).ok, false);
  });

  it("validates only the given fields when partial", () => {
    assert.deepEqual(validateTaskInput({ status: "done" }, { partial: true }, openDb()), {
      ok: true,
      value: { status: "done" },
    });
    assert.equal(validateTaskInput({ status: "x" }, { partial: true }, openDb()).ok, false);
  });
});

describe("createTask / updateTask", () => {
  it("creates a task and updates only the given fields", () => {
    const db = openDb();
    const created = createTask({ title: "新規", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    assert.equal(created.id, 8);
    assert.equal(listTasks({}, db).length, 8);
    const updated = updateTask(created.id, { status: "done" }, db);
    assert.deepEqual(updated, { ...created, status: "done" });
    assert.equal(updateTask(999, { status: "done" }, db), undefined);
  });
});

describe("isTaskStatus", () => {
  it("accepts known statuses only", () => {
    assert.equal(isTaskStatus("done"), true);
    assert.equal(isTaskStatus("unknown"), false);
    assert.equal(isTaskStatus(undefined), false);
  });
});
