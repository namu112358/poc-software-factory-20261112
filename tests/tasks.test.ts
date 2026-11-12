import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import {
  createTask,
  formatEstimate,
  formatTaskCount,
  getTask,
  isTaskStatus,
  listAssignees,
  listTasks,
  parseAssignee,
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

describe("listTasks by assignee", () => {
  it("filters by assignee", () => {
    const tasks = listTasks({ assignee: "sato" }, openDb());
    assert.equal(tasks.length, 3);
    assert.ok(tasks.every((t) => t.assignee === "sato"));
  });

  it("combines status and assignee", () => {
    const tasks = listTasks({ status: "todo", assignee: "sato" }, openDb());
    assert.deepEqual(
      tasks.map((t) => t.title),
      ["E2E テストの追加"],
    );
  });
});

describe("listAssignees", () => {
  it("returns assignees appearing in tasks without duplicates", () => {
    assert.deepEqual(
      listAssignees(openDb()).map((a) => a.id),
      ["sato", "suzuki", "tanaka"],
    );
  });

  it("excludes users with no tasks", () => {
    const db = openDb();
    db.prepare("INSERT INTO users (id, name, password_hash) VALUES ('new', '新人', 'x')").run();
    assert.ok(!listAssignees(db).some((a) => a.id === "new"));
  });
});

describe("parseAssignee", () => {
  it("accepts a known assignee and treats unknown values as unspecified", () => {
    const db = openDb();
    assert.equal(parseAssignee("sato", db), "sato");
    assert.equal(parseAssignee("nobody", db), undefined);
    assert.equal(parseAssignee(undefined, db), undefined);
    assert.equal(parseAssignee(["sato"], db), undefined);
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

describe("formatTaskCount", () => {
  it("shows the number of all tasks as 「N 件」", () => {
    const db = openDb();
    assert.equal(formatTaskCount(listTasks({}, db).length), "7 件");
  });

  it("shows the count after filtering by status", () => {
    const db = openDb();
    const todo = listTasks({ status: "todo" }, db);
    assert.equal(formatTaskCount(todo.length), "3 件");
  });

  it("shows 「0 件」 when nothing matches", () => {
    assert.equal(formatTaskCount(0), "0 件");
  });
});

describe("estimateMinutes", () => {
  const base = { title: "t", status: "todo", assignee: "sato", dueDate: "2026-12-01" };

  it("is null for seeded tasks and tasks created without it", () => {
    const db = openDb();
    assert.ok(listTasks({}, db).every((t) => t.estimateMinutes === null));
    const task = createTask({ ...base, status: "todo" }, db);
    assert.equal(task.estimateMinutes, null);
  });

  it("can be set on create, updated, and reset to null", () => {
    const db = openDb();
    const task = createTask({ ...base, status: "todo", estimateMinutes: 90 }, db);
    assert.equal(getTask(task.id, db)?.estimateMinutes, 90);
    assert.equal(updateTask(task.id, { estimateMinutes: 120 }, db)?.estimateMinutes, 120);
    assert.equal(updateTask(task.id, { title: "x" }, db)?.estimateMinutes, 120);
    assert.equal(updateTask(task.id, { estimateMinutes: null }, db)?.estimateMinutes, null);
  });

  it("validates range and integer-ness", () => {
    const db = openDb();
    const check = (v: unknown) => validateTaskInput({ estimateMinutes: v }, { partial: true }, db).ok;
    assert.equal(check(1), true);
    assert.equal(check(10000), true);
    assert.equal(check(null), true);
    for (const bad of [0, 10001, -5, 1.5, "90", NaN, true]) assert.equal(check(bad), false, String(bad));
    const r = validateTaskInput({ estimateMinutes: 0 }, { partial: true }, db);
    assert.ok(!r.ok && r.errors.length > 0);
  });

  it("formats for display", () => {
    assert.equal(formatEstimate(90), "90 分");
    assert.equal(formatEstimate(null), "—");
  });
});
