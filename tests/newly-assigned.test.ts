// 前回のログインのあとに自分の担当になったタスクを、ログイン後に知らせる（#369）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getLoginWindow, login } from "../src/lib/auth.ts";
import { listNewlyAssignedTasks, newlyAssignedNames } from "../src/lib/assignee-history.ts";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { createTask, type TaskInput } from "../src/lib/tasks.ts";

const PREV = "2026-11-10T00:00:00.000Z";
const NOW = "2026-11-12T00:00:00.000Z";

function setup() {
  const db = openDb();
  db.prepare("DELETE FROM tasks").run();
  return db;
}

function add(db: Db, title: string, extra: Partial<TaskInput> = {}) {
  return createTask(
    { title, status: "todo", assignee: "sato", dueDate: "2026-12-01", priority: "medium", estimateMinutes: null, memo: "", ...extra },
    db,
  ).id;
}

function change(db: Db, taskId: number, from: string, to: string, by: string | null, at: string) {
  db.prepare(
    "INSERT INTO task_assignee_changes (task_id, from_assignee, to_assignee, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)",
  ).run(taskId, from, to, by, at);
}

const list = (db: Db, prev: string | null | undefined = PREV, now: string | null | undefined = NOW) =>
  listNewlyAssignedTasks("sato", prev, now, db);

describe("新しく担当になったタスクの選び方", () => {
  it("前回のログインのあと・今回のログインまでに自分の担当に替えられたタスクを、新しい順に返す（まとめて替えた分も同じ）", () => {
    const db = setup();
    const a = add(db, "A");
    const b = add(db, "B");
    change(db, a, "suzuki", "sato", "tanaka", "2026-11-10T01:00:00.000Z");
    change(db, b, "suzuki", "sato", "tanaka", "2026-11-11T01:00:00.000Z");
    const rows = list(db);
    assert.deepEqual(rows.map((r) => r.title), ["B", "A"]);
    assert.equal(rows[0].fromAssignee, "suzuki");
    assert.equal(rows[0].changedBy, "tanaka");
    assert.equal(rows[0].changedAt, "2026-11-11T01:00:00.000Z");
  });

  it("前回のログインより前・今回のログインより後の変更は出ない", () => {
    const db = setup();
    const a = add(db, "前");
    const b = add(db, "後");
    change(db, a, "suzuki", "sato", "tanaka", "2026-11-09T23:59:59.000Z");
    change(db, b, "suzuki", "sato", "tanaka", "2026-11-12T00:00:01.000Z");
    assert.deepEqual(list(db), []);
  });

  it("自分で自分の担当にしたタスクは出ない", () => {
    const db = setup();
    const a = add(db, "自分で");
    change(db, a, "suzuki", "sato", "sato", "2026-11-11T01:00:00.000Z");
    assert.deepEqual(list(db), []);
  });

  it("替えた人が分からないタスクは、替えた人を「（不明）」として出す", () => {
    const db = setup();
    const a = add(db, "不明");
    change(db, a, "suzuki", "sato", null, "2026-11-11T01:00:00.000Z");
    const rows = list(db);
    assert.equal(rows.length, 1);
    assert.equal(newlyAssignedNames(rows[0]).by, "（不明）");
  });

  it("そのあとほかの人の担当に替わったタスクは出ない", () => {
    const db = setup();
    const a = add(db, "転送", { assignee: "tanaka" });
    change(db, a, "suzuki", "sato", "tanaka", "2026-11-11T01:00:00.000Z");
    change(db, a, "sato", "tanaka", "sato", "2026-11-11T02:00:00.000Z");
    assert.deepEqual(list(db), []);
  });

  it("完了したタスク・アーカイブしたタスクは出ない", () => {
    const db = setup();
    const done = add(db, "完了", { status: "done" });
    const arch = add(db, "アーカイブ", { archived: true });
    change(db, done, "suzuki", "sato", "tanaka", "2026-11-11T01:00:00.000Z");
    change(db, arch, "suzuki", "sato", "tanaka", "2026-11-11T01:00:00.000Z");
    assert.deepEqual(list(db), []);
  });

  it("期間内に何度か自分の担当になったタスクは、1 件にして最後の変更を使う", () => {
    const db = setup();
    const a = add(db, "往復");
    change(db, a, "suzuki", "sato", "tanaka", "2026-11-10T01:00:00.000Z");
    change(db, a, "sato", "suzuki", "sato", "2026-11-10T02:00:00.000Z");
    change(db, a, "tanaka", "sato", "suzuki", "2026-11-11T01:00:00.000Z");
    const rows = list(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].changedBy, "suzuki");
  });

  it("ほかの人の担当に替えられたタスクは出ない", () => {
    const db = setup();
    const a = add(db, "他人", { assignee: "suzuki" });
    change(db, a, "sato", "suzuki", "tanaka", "2026-11-11T01:00:00.000Z");
    assert.deepEqual(list(db), []);
  });

  it("前回のログインが無い（初めてのログイン）ときは出ない", () => {
    const db = setup();
    const a = add(db, "A");
    change(db, a, "suzuki", "sato", "tanaka", "2026-11-11T01:00:00.000Z");
    assert.deepEqual(list(db, null), []);
    assert.deepEqual(listNewlyAssignedTasks("sato", undefined, NOW, db), []);
    assert.deepEqual(listNewlyAssignedTasks("sato", PREV, undefined, db), []);
  });
});

describe("ログインした時点の期間", () => {
  it("セッションは、前回のログインと今回のログインの日時を持つ。初めてのログインの前回は null", () => {
    const db = openDb();
    const t1 = (login("sato", SEED_PASSWORD, db, new Date(PREV)) as { token: string }).token;
    const t2 = (login("sato", SEED_PASSWORD, db, new Date(NOW)) as { token: string }).token;
    const now = new Date(NOW);
    assert.deepEqual(getLoginWindow(t1, db, now), { previousLoginAt: null, loginAt: PREV });
    assert.deepEqual(getLoginWindow(t2, db, now), { previousLoginAt: PREV, loginAt: NOW });
    assert.equal(getLoginWindow("unknown", db, now), undefined);
  });
});
