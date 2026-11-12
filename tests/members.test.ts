import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createTask } from "../src/lib/tasks.ts";
import { countUnassignedOpenTasks, listMemberWorkload, truncateTitle } from "../src/lib/members.ts";

describe("truncateTitle", () => {
  it("keeps 10 characters or fewer and cuts longer titles with …", () => {
    assert.equal(truncateTitle("1234567890"), "1234567890");
    assert.equal(truncateTitle("12345678901"), "1234567890…");
    assert.equal(truncateTitle("🔥".repeat(11)), `${"🔥".repeat(10)}…`);
  });
});

describe("listMemberWorkload", () => {
  it("lists every member by id with open tasks (not done) in due-date order", () => {
    const rows = listMemberWorkload(openDb());
    assert.deepEqual(rows.map((r) => r.id), ["sato", "suzuki", "tanaka"]);
    const sato = rows[0];
    assert.equal(sato.openCount, 2);
    assert.deepEqual(sato.tasks.map((t) => t.title), ["API 設計", "E2E テストの追加"]);
    assert.equal(rows[1].openCount, 2);
    assert.deepEqual(rows[1].tasks.map((t) => t.title), ["ログイン画面のデザイン", "CI の整備"]);
  });

  it("shows zero when a member has no open tasks, and keeps the full title for the link", () => {
    const db = openDb();
    db.prepare("UPDATE tasks SET status = 'done' WHERE assignee = 'tanaka'").run();
    const tanaka = listMemberWorkload(db).find((r) => r.id === "tanaka")!;
    assert.equal(tanaka.openCount, 0);
    assert.deepEqual(tanaka.tasks, []);
    createTask({ title: "とても長い題名のタスクです", status: "todo", assignee: "tanaka", dueDate: "2026-12-01", priority: "medium", estimateMinutes: null, memo: "" } as never, db);
    const t = listMemberWorkload(db).find((r) => r.id === "tanaka")!.tasks[0];
    assert.equal(t.label, "とても長い題名のタス…");
    assert.equal(t.title, "とても長い題名のタスクです");
  });
});

describe("countUnassignedOpenTasks", () => {
  it("returns 0 when every task has an assignee", () => {
    assert.equal(countUnassignedOpenTasks(openDb()), 0);
  });

  it("counts only open tasks with an empty assignee", () => {
    const db = openDb();
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("UPDATE tasks SET assignee = '' WHERE id IN (SELECT id FROM tasks ORDER BY id LIMIT 3)").run();
    db.prepare("UPDATE tasks SET status = 'done' WHERE id = (SELECT id FROM tasks WHERE assignee = '' ORDER BY id LIMIT 1)").run();
    assert.equal(countUnassignedOpenTasks(db), 2);
  });
});
