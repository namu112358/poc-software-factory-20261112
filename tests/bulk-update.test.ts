import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { BULK_UPDATE_MAX, updateTasks, validateBulkUpdateInput } from "../src/lib/bulk-update.ts";
import { getTask, listTasks } from "../src/lib/tasks.ts";

// 初期データ: id 1 と 7 が done、2・3 が in_progress、4・5・6 が todo。
// 担当者: 1 sato、2 suzuki、3 sato、4 tanaka、5 suzuki、6 sato、7 tanaka。

const OLD = "2026-01-01T00:00:00.000Z";

function errorsOf(body: unknown) {
  const r = validateBulkUpdateInput(body, openDb());
  assert.equal(r.ok, false, `body=${JSON.stringify(body)}`);
  return r.ok ? [] : r.errors;
}

describe("validateBulkUpdateInput", () => {
  it("accepts ids with status and assignee changes", () => {
    const r = validateBulkUpdateInput({ ids: [1, 2, 3], changes: { status: "in_progress", assignee: "suzuki" } }, openDb());
    assert.deepEqual(r, { ok: true, value: { ids: [1, 2, 3], changes: { status: "in_progress", assignee: "suzuki" } } });
  });

  it("accepts status only or assignee only", () => {
    const db = openDb();
    assert.deepEqual(validateBulkUpdateInput({ ids: [1], changes: { status: "todo" } }, db), {
      ok: true,
      value: { ids: [1], changes: { status: "todo" } },
    });
    assert.deepEqual(validateBulkUpdateInput({ ids: [1], changes: { assignee: "tanaka" } }, db), {
      ok: true,
      value: { ids: [1], changes: { assignee: "tanaka" } },
    });
  });

  it("rejects fields other than status and assignee, even alongside allowed ones", () => {
    for (const changes of [{ title: "x" }, { status: "todo", dueDate: "2026-12-01" }, { assignee: "sato", memo: "" }]) {
      const errors = errorsOf({ ids: [1], changes });
      assert.ok(errors.length > 0);
    }
  });

  it("rejects empty changes", () => {
    assert.ok(errorsOf({ ids: [1], changes: {} }).length > 0);
  });

  it("rejects a missing or non-object changes", () => {
    for (const changes of [undefined, null, [], "status", 1]) {
      assert.ok(errorsOf({ ids: [1], changes }).length > 0, `changes=${JSON.stringify(changes)}`);
    }
  });

  it("rejects an invalid status", () => {
    for (const status of ["closed", "", null, 1, "DONE"]) {
      assert.ok(errorsOf({ ids: [1], changes: { status } }).length > 0, `status=${JSON.stringify(status)}`);
    }
  });

  it("rejects an assignee who does not exist, including null and non-strings", () => {
    for (const assignee of ["nobody", "", null, 1, "none"]) {
      assert.ok(errorsOf({ ids: [1], changes: { assignee } }).length > 0, `assignee=${JSON.stringify(assignee)}`);
    }
  });

  it("rejects a body that is not an object", () => {
    for (const body of [undefined, null, [1, 2], "ids"]) {
      assert.ok(errorsOf(body).length > 0);
    }
  });

  it("rejects missing, non-array and empty ids", () => {
    for (const ids of [undefined, 1, "1,2", { 0: 1 }, null, []]) {
      assert.ok(errorsOf({ ids, changes: { status: "todo" } }).length > 0, `ids=${JSON.stringify(ids)}`);
    }
  });

  it("rejects elements that are not positive integers", () => {
    for (const bad of ["1", 1.5, 0, -1, null, Number.MAX_SAFE_INTEGER + 1]) {
      assert.ok(errorsOf({ ids: [1, bad], changes: { status: "todo" } }).length > 0, `element=${String(bad)}`);
    }
  });

  it("rejects duplicated ids instead of merging them", () => {
    assert.ok(errorsOf({ ids: [3, 1, 3], changes: { status: "todo" } }).length > 0);
  });

  it("accepts up to the maximum and rejects one more", () => {
    const db = openDb();
    const max = Array.from({ length: BULK_UPDATE_MAX }, (_, i) => i + 1);
    assert.equal(validateBulkUpdateInput({ ids: max, changes: { status: "todo" } }, db).ok, true);
    assert.equal(validateBulkUpdateInput({ ids: [...max, BULK_UPDATE_MAX + 1], changes: { status: "todo" } }, db).ok, false);
  });
});

describe("updateTasks", () => {
  it("applies the changes to every given task and returns them in the given order", () => {
    const db = openDb();
    const result = updateTasks([5, 2, 4], { status: "in_progress", assignee: "suzuki" }, db);
    assert.ok(result.ok);
    assert.deepEqual(
      result.tasks.map((t) => [t.id, t.status, t.assignee]),
      [
        [5, "in_progress", "suzuki"],
        [2, "in_progress", "suzuki"],
        [4, "in_progress", "suzuki"],
      ],
    );
    for (const id of [5, 2, 4]) {
      assert.equal(getTask(id, db)?.status, "in_progress");
      assert.equal(getTask(id, db)?.assignee, "suzuki");
    }
  });

  it("does not touch tasks that were not given", () => {
    const db = openDb();
    const before = listTasks({}, db).filter((t) => t.id !== 4);
    updateTasks([4], { status: "done", assignee: "sato" }, db);
    assert.deepEqual(
      listTasks({}, db).filter((t) => t.id !== 4),
      before,
    );
  });

  it("changes nothing and reports every missing id in order when any id does not exist", () => {
    const db = openDb();
    const before = listTasks({}, db);
    const result = updateTasks([4, 999, 5, 1000], { status: "done" }, db);
    assert.deepEqual(result, { ok: false, missingIds: [999, 1000] });
    assert.deepEqual(listTasks({}, db), before);
  });

  it("rolls back every change when an update fails midway", () => {
    const db = openDb();
    db.exec("CREATE TRIGGER fail_on_5 BEFORE UPDATE ON tasks WHEN NEW.id = 5 BEGIN SELECT RAISE(ABORT, 'boom'); END");
    assert.throws(() => updateTasks([4, 5, 6], { status: "done" }, db));
    assert.equal(getTask(4, db)?.status, "todo");
    assert.equal(getTask(6, db)?.status, "todo");
  });

  it("updates the updated time of changed tasks and keeps the other fields", () => {
    const db = openDb();
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id IN (4, 5)").run(OLD);
    const before = [getTask(4, db)!, getTask(5, db)!];
    const result = updateTasks([4, 5], { status: "done" }, db);
    assert.ok(result.ok);
    for (const [i, after] of result.tasks.entries()) {
      assert.notEqual(after.updatedAt, OLD);
      assert.deepEqual({ ...after, status: before[i].status, updatedAt: OLD }, before[i]);
    }
    assert.equal(result.tasks[0].updatedAt, result.tasks[1].updatedAt);
  });

  it("keeps the assignee when only the status is changed, and the status when only the assignee is changed", () => {
    const db = openDb();
    const status = updateTasks([2], { status: "done" }, db);
    assert.ok(status.ok);
    assert.equal(status.tasks[0].assignee, "suzuki");
    const assignee = updateTasks([3], { assignee: "tanaka" }, db);
    assert.ok(assignee.ok);
    assert.equal(assignee.tasks[0].status, "in_progress");
  });

  it("keeps tasks that already have the given values as they are, including the updated time", () => {
    const db = openDb();
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id IN (2, 4)").run(OLD);
    const result = updateTasks([2, 4], { status: "in_progress", assignee: "suzuki" }, db); // 2 はすでに同じ値
    assert.ok(result.ok);
    assert.equal(result.tasks[0].updatedAt, OLD);
    assert.notEqual(result.tasks[1].updatedAt, OLD);
  });

  it("changes tasks regardless of their current assignee", () => {
    const db = openDb();
    const result = updateTasks([4, 5, 6], { assignee: "tanaka" }, db); // tanaka・suzuki・sato のタスク
    assert.ok(result.ok);
    assert.ok(result.tasks.every((t) => t.assignee === "tanaka"));
  });
});
