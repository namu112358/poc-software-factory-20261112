import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { updateTasks } from "../src/lib/bulk-update.ts";
import { setAbsence } from "../src/lib/absence.ts";
import { listAssigneeOptions } from "../src/lib/members.ts";
import { deleteTask, listAssignees, listTasks } from "../src/lib/tasks.ts";
import { listUserOptions } from "../src/lib/users.ts";

type Db = ReturnType<typeof openDb>;

// GET /api/assignees（src/app/api/assignees/route.ts）は、ログインを確かめた後に
// { assignees: listUserOptions() } を返す。ルートは next/server を読み込むため単体テストから呼べない。
// 200・401 の応答は手動確認で確かめた。ここでは、返す中身を確かめる（#492）。
const apiAssignees = (db: Db) => ({ assignees: listUserOptions(db) });
const ids = (db: Db) => apiAssignees(db).assignees.map((a) => a.id);

/** 鈴木の担当のタスクを、まとめて佐藤へ替える（Issue の再現手順と同じ操作）。替えたタスクの ID を返す。 */
function handOverSuzuki(db: Db): number[] {
  const taskIds = listTasks({ assignees: ["suzuki"] }, db).map((t) => t.id);
  assert.ok(taskIds.length > 0);
  updateTasks(taskIds, { assignee: "sato" }, db);
  assert.equal(listTasks({ assignees: ["suzuki"] }, db).length, 0);
  return taskIds;
}

describe("GET /api/assignees が返す担当者の候補", () => {
  it("担当のタスクがある利用者を全員、ID 順に返す", () => {
    assert.deepEqual(ids(openDb()), ["sato", "suzuki", "tanaka"]);
  });

  it("担当のタスクをすべてほかの人に替えたあとの利用者も返す", () => {
    const db = openDb();
    handOverSuzuki(db);
    assert.deepEqual(ids(db), ["sato", "suzuki", "tanaka"]);
  });

  it("担当を替えてから戻しても、その利用者は 1 回だけ出る", () => {
    const db = openDb();
    const taskIds = handOverSuzuki(db);
    updateTasks(taskIds, { assignee: "suzuki" }, db);
    assert.deepEqual(ids(db), ["sato", "suzuki", "tanaka"]);
  });

  it("担当のタスクを削除した・アーカイブした・完了にした利用者も返す", () => {
    const deleted = openDb();
    for (const t of listTasks({ assignees: ["tanaka"] }, deleted)) assert.equal(deleteTask(t.id, "tanaka", deleted), "deleted");
    assert.ok(ids(deleted).includes("tanaka"));

    const archived = openDb();
    archived.prepare("UPDATE tasks SET archived = 1 WHERE assignee = ?").run("tanaka");
    assert.ok(ids(archived).includes("tanaka"));

    const done = openDb();
    done.prepare("UPDATE tasks SET status = 'done' WHERE assignee = ?").run("tanaka");
    assert.ok(ids(done).includes("tanaka"));
  });

  it("新しいタスク・担当の変更・一覧の絞り込みの担当者の選択肢と、同じ人・同じ名前・同じ並び", () => {
    const db = openDb();
    handOverSuzuki(db);
    setAbsence("tanaka", { startDate: "2099-01-01", endDate: "2099-01-05" }, db);
    const options = listAssigneeOptions(db).map(({ id, name }) => ({ id, name }));
    assert.deepEqual(apiAssignees(db).assignees, options);
  });

  it("応答の形は { assignees: [{ id, name }] } のまま、ほかの列は混ざらない", () => {
    const db = openDb();
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run("secret-hash", "suzuki");
    const body = apiAssignees(db);
    assert.deepEqual(Object.keys(body), ["assignees"]);
    for (const a of body.assignees) {
      assert.deepEqual(Object.keys(a).sort(), ["id", "name"]);
      assert.equal(typeof a.id, "string");
      assert.equal(typeof a.name, "string");
    }
    assert.equal(body.assignees.find((a) => a.id === "suzuki")?.name, "鈴木");
    assert.ok(!JSON.stringify(body).includes("secret-hash"));
  });
});

// 一覧の画面は、担当者の名前の表示に listAssignees()（タスクに登場する担当者）を使う。
// API を替えても、こちらの振る舞いは変えない。
describe("listAssignees（一覧の画面の担当者の名前の表示）", () => {
  it("returns id and name of each person who has tasks, once each, in ascending id order", () => {
    const assignees = listAssignees(openDb());
    assert.ok(assignees.length > 0);
    const assigneeIds = assignees.map((a) => a.id);
    assert.deepEqual(assigneeIds, [...new Set(assigneeIds)].sort());
    for (const a of assignees) assert.deepEqual(Object.keys(a).sort(), ["id", "name"]);
  });

  it("does not list a user who has no tasks", () => {
    const db = openDb();
    db.prepare("DELETE FROM tasks WHERE assignee = ?").run("tanaka");
    assert.ok(!listAssignees(db).some((a) => a.id === "tanaka"));
  });
});
