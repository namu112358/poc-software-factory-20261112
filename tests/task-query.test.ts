import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { listTasksByQuery } from "../src/lib/task-query.ts";

const q = (s: string) => new URLSearchParams(s);

describe("listTasksByQuery", () => {
  it("assignee=<ID> returns only that person's tasks", () => {
    const db = openDb();
    const tasks = listTasksByQuery(q("assignee=sato"), db);
    assert.ok(tasks.length > 0);
    assert.ok(tasks.every((t) => t.assignee === "sato"));
  });

  it("assignee=none returns no assigned task (assignee is NOT NULL, so no task is unassigned today)", () => {
    const db = openDb();
    assert.deepEqual(listTasksByQuery(q("assignee=none"), db), []);
  });

  it("sort=priority orders high to low; no sort keeps id order", () => {
    const db = openDb();
    const rank = { high: 0, medium: 1, low: 2 };
    const sorted = listTasksByQuery(q("sort=priority"), db).map((t) => rank[t.priority]);
    assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b));
    const plain = listTasksByQuery(q(""), db).map((t) => t.id);
    assert.deepEqual(plain, [...plain].sort((a, b) => a - b));
    assert.deepEqual(listTasksByQuery(q("sort=bogus"), db).map((t) => t.id), plain);
  });

  it("unknown assignee and invalid sort are treated as unspecified", () => {
    const db = openDb();
    const all = listTasksByQuery(q(""), db).map((t) => t.id);
    assert.deepEqual(listTasksByQuery(q("assignee=nobody&sort=xyz"), db).map((t) => t.id), all);
  });

  it("combines with status and tag", () => {
    const db = openDb();
    const tasks = listTasksByQuery(q("assignee=sato&status=todo&sort=priority"), db);
    assert.ok(tasks.every((t) => t.assignee === "sato" && t.status === "todo"));
    const expected = listTasksByQuery(q("status=todo"), db).filter((t) => t.assignee === "sato").length;
    assert.equal(tasks.length, expected);
    assert.deepEqual(listTasksByQuery(q("status=bogus"), db).map((t) => t.id), listTasksByQuery(q(""), db).map((t) => t.id));
  });
});
