import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, openDb } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { createTask, getTask, listTasks, updateTask, validateTaskInput } from "../src/lib/tasks.ts";
import { listTasksByQuery } from "../src/lib/task-query.ts";

describe("アーカイブ", () => {
  it("archived: true にすると、一覧（画面・API 共通の取得）に含まれなくなる", () => {
    const db = openDb();
    const before = listTasks({}, db).length;
    updateTask(4, { archived: true }, db);
    assert.equal(listTasks({}, db).length, before - 1);
    assert.ok(!listTasks({}, db).some((t) => t.id === 4));
    assert.ok(!listTasksByQuery(new URLSearchParams(), db).some((t) => t.id === 4));
  });

  it("archived: false にすると、再び一覧に含まれる", () => {
    const db = openDb();
    updateTask(4, { archived: true }, db);
    updateTask(4, { archived: false }, db);
    assert.ok(listTasks({}, db).some((t) => t.id === 4));
  });

  it("アーカイブしたタスクも getTask で取得でき、archived: true が含まれる。ほかの項目は変わらない", () => {
    const db = openDb();
    const before = getTask(4, db)!;
    updateTask(4, { archived: true }, db);
    const after = getTask(4, db)!;
    assert.equal(after.archived, true);
    assert.equal(after.title, before.title);
    assert.equal(after.status, before.status);
  });

  it("includeArchived を指定したときだけ、アーカイブ済みも一覧に含まれる", () => {
    const db = openDb();
    updateTask(4, { archived: true }, db);
    assert.ok(listTasks({ includeArchived: true }, db).some((t) => t.id === 4));
  });

  it("ほかの項目の更新では、アーカイブの状態は変わらない", () => {
    const db = openDb();
    updateTask(4, { archived: true }, db);
    updateTask(4, { title: "名前を変えた" }, db);
    assert.equal(getTask(4, db)!.archived, true);
  });

  it("新しく作ったタスクは、アーカイブしていない", () => {
    const db = openDb();
    const t = createTask({ title: "新規", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    assert.equal(t.archived, false);
  });

  it("archived に真偽値以外を送ると検証で弾かれる", () => {
    const db = openDb();
    for (const bad of ["true", 1, 0, null, "", [], {}]) {
      const r = validateTaskInput({ archived: bad }, { partial: true }, db);
      assert.equal(r.ok, false, JSON.stringify(bad));
    }
    assert.deepEqual(validateTaskInput({ archived: true }, { partial: true }, db), { ok: true, value: { archived: true } });
    assert.deepEqual(validateTaskInput({ archived: false }, { partial: true }, db), { ok: true, value: { archived: false } });
  });

  it("マイグレーション前からあるタスクは、マイグレーション後すべてアーカイブしていない", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, MIGRATIONS.filter((m) => m.version < 12));
    db.prepare("INSERT INTO users (id, name) VALUES ('sato', '佐藤')").run();
    db.prepare("INSERT INTO tasks (title, status, assignee, due_date) VALUES ('A', 'done', 'sato', '2026-11-01')").run();
    db.prepare("INSERT INTO tasks (title, status, assignee, due_date) VALUES ('B', 'todo', 'sato', '2026-11-02')").run();
    migrate(db);
    assert.deepEqual(listTasks({}, db).map((t) => t.archived), [false, false]);
  });
});
