import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { BULK_COMPLETE_MAX, completeTasks, getTask, listTasks, validateBulkCompleteInput } from "../src/lib/tasks.ts";

// 初期データ: id 1 と 7 が done、2・3 が in_progress、4・5・6 が todo。

describe("validateBulkCompleteInput", () => {
  it("accepts an array of positive integers", () => {
    assert.deepEqual(validateBulkCompleteInput({ ids: [1, 2, 3] }), { ok: true, value: [1, 2, 3] });
  });

  it("rejects a missing ids with a reason", () => {
    const r = validateBulkCompleteInput({});
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.errors.length > 0);
  });

  it("rejects ids that is not an array with a reason", () => {
    for (const ids of [1, "1,2", { 0: 1 }, null]) {
      const r = validateBulkCompleteInput({ ids });
      assert.equal(r.ok, false, `ids=${JSON.stringify(ids)}`);
      assert.ok(!r.ok && r.errors.length > 0);
    }
  });

  it("rejects a body that is not an object", () => {
    for (const body of [undefined, null, [1, 2], "ids"]) {
      assert.equal(validateBulkCompleteInput(body).ok, false, `body=${JSON.stringify(body)}`);
    }
  });

  it("rejects an empty array", () => {
    assert.equal(validateBulkCompleteInput({ ids: [] }).ok, false);
  });

  it("rejects elements that are not positive integers", () => {
    for (const bad of ["1", 1.5, 0, -1, null, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(validateBulkCompleteInput({ ids: [1, bad] }).ok, false, `element=${String(bad)}`);
    }
  });

  it("accepts up to the maximum and rejects one more", () => {
    const max = Array.from({ length: BULK_COMPLETE_MAX }, (_, i) => i + 1);
    assert.equal(validateBulkCompleteInput({ ids: max }).ok, true);
    assert.equal(validateBulkCompleteInput({ ids: [...max, BULK_COMPLETE_MAX + 1] }).ok, false);
  });

  it("merges duplicate ids, keeping the first-seen order", () => {
    assert.deepEqual(validateBulkCompleteInput({ ids: [3, 1, 3, 1] }), { ok: true, value: [3, 1] });
  });
});

describe("completeTasks", () => {
  it("marks the given tasks as done and returns them in the given order", () => {
    const db = openDb();
    const result = completeTasks([5, 2, 4], db);
    assert.ok(result.ok);
    assert.deepEqual(
      result.tasks.map((t) => [t.id, t.status]),
      [
        [5, "done"],
        [2, "done"],
        [4, "done"],
      ],
    );
    assert.equal(getTask(5, db)?.status, "done");
    assert.equal(getTask(2, db)?.status, "done");
    assert.equal(getTask(4, db)?.status, "done");
  });

  it("does not touch tasks that were not given", () => {
    const db = openDb();
    completeTasks([4], db);
    assert.equal(getTask(3, db)?.status, "in_progress");
    assert.equal(getTask(6, db)?.status, "todo");
  });

  it("changes nothing and reports the missing ids when any id does not exist", () => {
    const db = openDb();
    const before = listTasks({}, db);
    const result = completeTasks([4, 999, 5, 1000], db);
    assert.deepEqual(result, { ok: false, missingIds: [999, 1000] });
    assert.deepEqual(listTasks({}, db), before);
  });

  it("rolls back every change when an update fails midway", () => {
    const db = openDb();
    db.exec("CREATE TRIGGER fail_on_5 BEFORE UPDATE ON tasks WHEN NEW.id = 5 BEGIN SELECT RAISE(ABORT, 'boom'); END");
    assert.throws(() => completeTasks([4, 5], db));
    assert.equal(getTask(4, db)?.status, "todo");
  });

  it("keeps already-done tasks as they are, including the updated time", () => {
    const db = openDb();
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id IN (1, 4)").run("2026-01-01T00:00:00.000Z");
    const result = completeTasks([1, 4], db);
    assert.ok(result.ok);
    const [done, completed] = result.tasks;
    assert.equal(done.status, "done");
    assert.equal(done.updatedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(completed.status, "done");
    assert.notEqual(completed.updatedAt, "2026-01-01T00:00:00.000Z");
  });

  it("completes tasks regardless of assignee", () => {
    const db = openDb();
    const result = completeTasks([4, 5, 6], db); // tanaka・suzuki・sato のタスク
    assert.ok(result.ok);
    assert.deepEqual(new Set(result.tasks.map((t) => t.assignee)), new Set(["tanaka", "suzuki", "sato"]));
    assert.ok(result.tasks.every((t) => t.status === "done"));
  });
});
