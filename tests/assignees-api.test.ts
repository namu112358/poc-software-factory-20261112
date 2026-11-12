import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { listAssignees } from "../src/lib/tasks.ts";

// GET /api/assignees が返す中身は listAssignees()（一覧の絞り込みの選択肢）そのもの。
describe("listAssignees（GET /api/assignees の中身）", () => {
  it("returns id and name of each person who has tasks, once each, in ascending id order", () => {
    const assignees = listAssignees(openDb());
    assert.ok(assignees.length > 0);
    const ids = assignees.map((a) => a.id);
    assert.deepEqual(ids, [...new Set(ids)].sort());
    for (const a of assignees) assert.deepEqual(Object.keys(a).sort(), ["id", "name"]);
  });

  it("does not list a user who has no tasks", () => {
    const db = openDb();
    db.prepare("DELETE FROM tasks WHERE assignee = ?").run("tanaka");
    assert.ok(!listAssignees(db).some((a) => a.id === "tanaka"));
  });
});
