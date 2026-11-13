import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { validateTaskInput } from "../src/lib/task-validation.ts";

const base = { title: "t", assignee: "sato", status: "todo" };

describe("dueDate must be a real calendar date", () => {
  const db = openDb(":memory:");
  for (const dueDate of ["2026-02-30", "2026-04-31", "2025-02-29", "2026-13-01", "2026-02-32", "2026-2-3"]) {
    it(`rejects ${dueDate} on create and update`, () => {
      assert.equal(validateTaskInput({ ...base, dueDate }, {}, db).ok, false);
      assert.equal(validateTaskInput({ dueDate }, { partial: true }, db).ok, false);
    });
  }
  for (const dueDate of ["2028-02-29", "2026-02-28", "2026-12-31"]) {
    it(`accepts ${dueDate}`, () => {
      assert.equal(validateTaskInput({ ...base, dueDate }, {}, db).ok, true);
      assert.equal(validateTaskInput({ dueDate }, { partial: true }, db).ok, true);
    });
  }
});
