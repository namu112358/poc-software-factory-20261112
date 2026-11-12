import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, openDb } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { updateTasks } from "../src/lib/bulk-update.ts";
import {
  completeTasks,
  createTask,
  duplicateTask,
  getTask,
  listTasks,
  updateTask,
  validateTaskInput,
} from "../src/lib/tasks.ts";

// 初期データ: id 1 と 7 が done（完了日時は空）、2・3 が in_progress、4・5・6 が todo。
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** 完了日時を決まった値にしておく（同じミリ秒の更新と見分けるため）。 */
function setCompletedAt(db: DatabaseSync, id: number, value: string | null): void {
  db.prepare("UPDATE tasks SET completed_at = ? WHERE id = ?").run(value, id);
}

describe("完了日時: 1 件の更新", () => {
  it("done に変えると、更新時刻（ISO 8601、UTC）が completedAt に入り、updatedAt と同じになる", () => {
    const db = openDb();
    const before = Date.now();
    const task = updateTask(4, { status: "done" }, db)!;
    assert.match(task.completedAt!, ISO_UTC);
    assert.ok(Date.parse(task.completedAt!) >= before - 1);
    assert.equal(task.completedAt, task.updatedAt);
  });

  it("done から todo / in_progress に戻すと null になる", () => {
    for (const status of ["todo", "in_progress"] as const) {
      const db = openDb();
      updateTask(4, { status: "done" }, db);
      assert.equal(updateTask(4, { status }, db)!.completedAt, null, status);
    }
  });

  it("done のままメモだけ更新しても completedAt は変わらない", () => {
    const db = openDb();
    updateTask(4, { status: "done" }, db);
    setCompletedAt(db, 4, "2026-11-01T00:00:00.000Z");
    const task = updateTask(4, { memo: "振り返りのメモ" }, db)!;
    assert.equal(task.memo, "振り返りのメモ");
    assert.equal(task.completedAt, "2026-11-01T00:00:00.000Z");
  });

  it("すでに done のタスクに status: done をもう一度送っても completedAt は変わらない", () => {
    const db = openDb();
    updateTask(4, { status: "done" }, db);
    setCompletedAt(db, 4, "2026-11-01T00:00:00.000Z");
    assert.equal(updateTask(4, { status: "done", title: "改題" }, db)!.completedAt, "2026-11-01T00:00:00.000Z");
  });

  it("完了日時が空の完了済みタスクは、更新や done の再送では空のまま。戻してから完了にすると記録される", () => {
    const db = openDb();
    assert.equal(getTask(1, db)!.completedAt, null);
    assert.equal(updateTask(1, { memo: "追記" }, db)!.completedAt, null);
    assert.equal(updateTask(1, { status: "done" }, db)!.completedAt, null);
    updateTask(1, { status: "todo" }, db);
    assert.match(updateTask(1, { status: "done" }, db)!.completedAt!, ISO_UTC);
  });

  it("done 以外のタスクをほかの項目だけ更新しても null のまま", () => {
    const db = openDb();
    assert.equal(updateTask(2, { title: "ログイン画面のデザイン（改）" }, db)!.completedAt, null);
  });

  it("本文の completedAt は検証で捨てられ、利用者が完了日時を書き換えられない", () => {
    const db = openDb();
    const r = validateTaskInput({ memo: "x", completedAt: "2000-01-01T00:00:00.000Z" }, { partial: true }, db);
    assert.ok(r.ok);
    assert.ok(r.ok && !("completedAt" in r.value));
    assert.equal(updateTask(2, r.ok ? r.value : {}, db)!.completedAt, null);
  });
});

describe("完了日時: 作成と複製", () => {
  it("done で作成すると作成時刻、それ以外は null", () => {
    const db = openDb();
    const done = createTask({ title: "a", status: "done", assignee: "sato", dueDate: "2026-12-01" }, db);
    assert.equal(done.completedAt, done.createdAt);
    const todo = createTask({ title: "b", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    assert.equal(todo.completedAt, null);
  });

  it("完了したタスクを複製すると todo なので null", () => {
    const db = openDb();
    updateTask(4, { status: "done" }, db);
    assert.equal(duplicateTask(4, db)!.completedAt, null);
  });
});

describe("完了日時: 一括完了", () => {
  it("完了にしたタスクに completedAt が入り、すでに完了だったタスクの値は変わらない", () => {
    const db = openDb();
    updateTask(4, { status: "done" }, db);
    setCompletedAt(db, 4, "2026-11-01T00:00:00.000Z");
    const r = completeTasks([2, 4, 1], db);
    assert.ok(r.ok);
    if (!r.ok) return;
    const [t2, t4, t1] = r.tasks;
    assert.match(t2.completedAt!, ISO_UTC);
    assert.equal(t2.completedAt, t2.updatedAt);
    assert.equal(t4.completedAt, "2026-11-01T00:00:00.000Z");
    assert.equal(t1.completedAt, null);
  });

  it("存在しない ID が混じると、どのタスクにも completedAt は入らない", () => {
    const db = openDb();
    assert.equal(completeTasks([2, 999], db).ok, false);
    assert.equal(getTask(2, db)!.completedAt, null);
  });
});

describe("完了日時: 一括変更", () => {
  it("done にしたタスクに記録し、すでに done のタスクの値は変えない", () => {
    const db = openDb();
    setCompletedAt(db, 7, "2026-11-01T00:00:00.000Z");
    const r = updateTasks([3, 7], { status: "done" }, db);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.match(r.tasks[0].completedAt!, ISO_UTC);
    assert.equal(r.tasks[1].completedAt, "2026-11-01T00:00:00.000Z");
  });

  it("done 以外にしたタスクは null に戻り、担当者だけの変更では変わらない", () => {
    const db = openDb();
    setCompletedAt(db, 7, "2026-11-01T00:00:00.000Z");
    setCompletedAt(db, 1, "2026-11-02T00:00:00.000Z");
    updateTasks([7], { assignee: "suzuki" }, db);
    assert.equal(getTask(7, db)!.completedAt, "2026-11-01T00:00:00.000Z");
    updateTasks([1], { status: "in_progress" }, db);
    assert.equal(getTask(1, db)!.completedAt, null);
  });

  it("存在しない ID が混じると、どのタスクにも completedAt は入らない", () => {
    const db = openDb();
    assert.equal(updateTasks([4, 999], { status: "done" }, db).ok, false);
    assert.equal(getTask(4, db)!.completedAt, null);
  });
});

describe("完了日時: マイグレーションと取得", () => {
  it("マイグレーション前からある完了済みタスクは、マイグレーション後 completedAt が null", () => {
    const db = new DatabaseSync(":memory:");
    const before = MIGRATIONS.filter((m) => m.version < 11);
    migrate(db, before);
    db.prepare("INSERT INTO users (id, name) VALUES ('sato', '佐藤')").run();
    db.prepare("INSERT INTO tasks (title, status, assignee, due_date) VALUES ('済', 'done', 'sato', '2026-11-01')").run();
    migrate(db);
    assert.equal(getTask(1, db)!.completedAt, null);
  });

  it("一覧と 1 件の取得の結果に completedAt が含まれる", () => {
    const db = openDb();
    updateTask(4, { status: "done" }, db);
    for (const t of listTasks({}, db)) assert.ok("completedAt" in t, `id=${t.id}`);
    assert.match(listTasks({}, db).find((t) => t.id === 4)!.completedAt!, ISO_UTC);
    assert.match(getTask(4, db)!.completedAt!, ISO_UTC);
  });
});
