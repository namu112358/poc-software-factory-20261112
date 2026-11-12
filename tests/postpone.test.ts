import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { addSevenDays, postponeTask } from "../src/lib/postpone.ts";
import { getTask } from "../src/lib/tasks.ts";

describe("addSevenDays", () => {
  it("adds 7 days within a month", () => {
    assert.equal(addSevenDays("2026-11-20"), "2026-11-27");
  });
  it("crosses month and year boundaries", () => {
    assert.equal(addSevenDays("2026-11-28"), "2026-12-05");
    assert.equal(addSevenDays("2026-12-28"), "2027-01-04");
  });
  it("handles leap years", () => {
    assert.equal(addSevenDays("2028-02-25"), "2028-03-03");
    assert.equal(addSevenDays("2027-02-25"), "2027-03-04");
  });
});

describe("postponeTask", () => {
  it("moves the due date 7 days later and returns the updated task", () => {
    const db = openDb();
    const before = getTask(2, db)!;
    assert.notEqual(before.status, "done");
    const r = postponeTask(2, db, new Date("2030-01-01T00:00:00Z"));
    assert.ok(r.ok);
    assert.equal(r.task.dueDate, addSevenDays(before.dueDate));
    assert.equal(r.task.updatedAt, "2030-01-01T00:00:00.000Z");
    assert.deepEqual(getTask(2, db), r.task);
    assert.equal(r.task.title, before.title);
  });

  it("does not change a done task", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    assert.equal(before.status, "done");
    assert.deepEqual(postponeTask(1, db), { ok: false, reason: "done" });
    assert.deepEqual(getTask(1, db), before);
  });

  it("reports a missing task", () => {
    assert.deepEqual(postponeTask(9999, openDb()), { ok: false, reason: "not_found" });
  });

  it("only changes the target task", () => {
    const db = openDb();
    const other = getTask(3, db)!;
    postponeTask(2, db);
    assert.deepEqual(getTask(3, db), other);
  });
});
