// 削除したタスクを、30 日のあいだは元に戻せること（#378）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listNewlyAssignedTasks } from "../src/lib/assignee-history.ts";
import { createComment, listComments } from "../src/lib/comments.ts";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { createExtension, decideExtension, listExtensions, listMyExtensions, listPendingExtensions } from "../src/lib/extensions.ts";
import { listMemberWorkload } from "../src/lib/members.ts";
import { listMyDueTasks } from "../src/lib/my-attention.ts";
import { listOverdueTasks } from "../src/lib/overdue.ts";
import { addTag, listTagCounts, listTags } from "../src/lib/tags.ts";
import { countTasksByStatus } from "../src/lib/task-count.ts";
import { requestRestoreTask } from "../src/lib/task-delete.ts";
import { updateTasks } from "../src/lib/bulk-update.ts";
import { exportTasksCsv } from "../src/lib/export.ts";
import {
  RESTORE_DAYS,
  completeTasks,
  createTask,
  deleteTask,
  duplicateTask,
  getTask,
  listAssignees,
  listDeletedTasks,
  listTasks,
  restoreTask,
  updateTask,
  updateTaskIfUnchanged,
} from "../src/lib/tasks.ts";

// シードのタスク 3 は sato が担当（進行中・期限 2026-11-14）、タスク 4 は tanaka が担当（未着手）。
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-12T03:00:00.000Z");
const after = (ms: number) => new Date(T0.getTime() + ms);

describe("削除したタスクは、一覧・API・集計に出ない", () => {
  it("タスク一覧（アーカイブを含めても）・詳細・担当者の一覧・CSV に出ない", () => {
    const db = openDb();
    const solo = createTask({ title: "鈴木だけの削除対象", status: "todo", assignee: "suzuki", dueDate: "2026-11-30" }, db);
    db.prepare("UPDATE tasks SET assignee = 'sato' WHERE assignee = 'suzuki' AND id <> ?").run(solo.id);
    assert.equal(deleteTask(solo.id, "suzuki", db), "deleted");
    assert.equal(getTask(solo.id, db), undefined);
    assert.ok(!listTasks({ includeArchived: true }, db).some((t) => t.id === solo.id));
    assert.ok(!listTasks({ q: "削除対象" }, db).some((t) => t.id === solo.id));
    assert.ok(!listAssignees(db).some((a) => a.id === "suzuki"));
    assert.doesNotMatch(exportTasksCsv({}, db), /削除対象/);
  });

  it("アーカイブ済みのタスクを消しても、アーカイブ込みの一覧に出ない", () => {
    const db = openDb();
    updateTask(3, { archived: true }, db);
    assert.equal(deleteTask(3, "sato", db), "deleted");
    assert.ok(!listTasks({ includeArchived: true }, db).some((t) => t.id === 3));
  });

  it("ステータスごとの件数・期限切れ・メンバーの件数・自分の対応・タグの件数に出ない", () => {
    const db = openDb();
    addTag(3, "消すタグ", db);
    const before = countTasksByStatus(db);
    const today = "2026-11-20"; // タスク 3 の期限（11/14）を過ぎた日
    assert.ok(listOverdueTasks(db, today).some((r) => r.id === 3));
    assert.ok(listMyDueTasks("sato", db, today).some((r) => r.id === 3));
    const satoOpen = listMemberWorkload(db).find((m) => m.id === "sato")!.openCount;
    assert.equal(deleteTask(3, "sato", db), "deleted");
    assert.equal(countTasksByStatus(db).in_progress, before.in_progress - 1);
    assert.ok(!listOverdueTasks(db, today).some((r) => r.id === 3));
    assert.ok(!listMyDueTasks("sato", db, today).some((r) => r.id === 3));
    const sato = listMemberWorkload(db).find((m) => m.id === "sato")!;
    assert.equal(sato.openCount, satoOpen - 1);
    assert.ok(!sato.tasks.some((t) => t.id === 3));
    assert.ok(!listTagCounts(db).some((t) => t.name === "消すタグ"));
  });

  it("承認待ちの延長・自分の延長の申請・新しく担当になったタスクに出ない", () => {
    const db = openDb();
    createExtension({ taskId: 3, requester: "sato", newDueDate: "2026-12-01", reason: "理由" }, db, T0);
    updateTask(3, { assignee: "tanaka" }, db, "suzuki");
    const changedAt = (db.prepare("SELECT changed_at FROM task_assignee_changes WHERE task_id = 3").get() as { changed_at: string }).changed_at;
    const prev = new Date(Date.parse(changedAt) - 1000).toISOString();
    const login = new Date(Date.parse(changedAt) + 1000).toISOString();
    assert.equal(listNewlyAssignedTasks("tanaka", prev, login, db).length, 1);
    assert.equal(listPendingExtensions(db).length, 1);
    assert.equal(listMyExtensions("sato", db, T0).length, 1);
    assert.equal(deleteTask(3, "tanaka", db), "deleted");
    assert.deepEqual(listPendingExtensions(db), []);
    assert.deepEqual(listMyExtensions("sato", db, T0), []);
    assert.deepEqual(listNewlyAssignedTasks("tanaka", prev, login, db), []);
  });
});

describe("削除したタスクは、変更・複製できない（見つからない扱い）", () => {
  it("1 件の更新・確認つきの更新・複製は見つからない", () => {
    const db = openDb();
    const task = getTask(3, db)!;
    assert.equal(deleteTask(3, "sato", db), "deleted");
    assert.equal(updateTask(3, { title: "書き換え" }, db), undefined);
    assert.deepEqual(updateTaskIfUnchanged(3, { title: "書き換え" }, task.updatedAt, db), { ok: false, reason: "not_found" });
    assert.equal(duplicateTask(3, db), undefined);
    assert.equal(restoreTask(3, "sato", db), "restored");
    assert.equal(getTask(3, db)!.title, task.title);
  });

  it("まとめての変更・完了に削除済みの ID が混じると、どのタスクも変えない（全部か無しか）", () => {
    const db = openDb();
    const four = getTask(4, db)!;
    assert.equal(deleteTask(3, "sato", db), "deleted");
    assert.deepEqual(updateTasks([4, 3], { status: "done" }, db), { ok: false, missingIds: [3] });
    assert.deepEqual(completeTasks([4, 3], db), { ok: false, missingIds: [3] });
    assert.deepEqual(getTask(4, db), four);
    assert.equal(restoreTask(3, "sato", db), "restored");
    assert.equal(getTask(3, db)!.status, "in_progress");
  });

  it("延長の申請を承認しても、削除済みのタスクの期限は変わらない（同時に削除されたとき）", () => {
    const db = openDb();
    const ext = createExtension({ taskId: 3, requester: "sato", newDueDate: "2026-12-01", reason: "理由" }, db, T0);
    assert.ok(ext !== "conflict");
    assert.equal(deleteTask(3, "sato", db), "deleted");
    decideExtension(3, ext.id, "approved", "tanaka", db, T0);
    assert.equal(restoreTask(3, "sato", db), "restored");
    assert.equal(getTask(3, db)!.dueDate, "2026-11-14");
  });
});

describe("削除したタスクの一覧", () => {
  it("削除した日時の新しい順に、題名・担当者・削除した人・削除した日時・元に戻せる期限が並ぶ", () => {
    const db = openDb();
    assert.equal(deleteTask(4, "tanaka", db, T0), "deleted");
    assert.equal(deleteTask(3, "sato", db, after(60_000)), "deleted");
    assert.equal(deleteTask(1, "sato", db, after(-60_000)), "deleted");
    const rows = listDeletedTasks(db, after(120_000));
    assert.deepEqual(rows.map((r) => r.id), [3, 4, 1]);
    assert.deepEqual(rows[1], {
      id: 4,
      title: "DB スキーマ作成",
      assignee: "tanaka",
      assigneeName: "田中",
      deletedBy: "tanaka",
      deletedByName: "田中",
      deletedAt: "2026-11-12T03:00:00.000Z",
      restoreDeadline: "2026-12-12T03:00:00.000Z",
    });
  });

  it("削除していないタスク・元に戻したタスクは出ない", () => {
    const db = openDb();
    assert.deepEqual(listDeletedTasks(db, T0), []);
    deleteTask(3, "sato", db, T0);
    restoreTask(3, "sato", db, T0);
    assert.deepEqual(listDeletedTasks(db, T0), []);
  });
});

describe("期間（30 日）の判定", () => {
  it("期間は 30 日", () => {
    assert.equal(RESTORE_DAYS, 30);
  });

  it("30 日ちょうどの 1 ミリ秒前までは一覧に出て戻せ、30 日ちょうどになると一覧に出ず戻せない", () => {
    const edge = after(30 * DAY - 1);
    const db1 = openDb();
    deleteTask(3, "sato", db1, T0);
    assert.deepEqual(listDeletedTasks(db1, edge).map((r) => r.id), [3]);
    assert.equal(restoreTask(3, "sato", db1, edge), "restored");

    const db2 = openDb();
    deleteTask(3, "sato", db2, T0);
    assert.deepEqual(listDeletedTasks(db2, after(30 * DAY)), []);
    assert.equal(restoreTask(3, "sato", db2, after(30 * DAY)), "not_found");
    assert.equal(restoreTask(3, "tanaka", db2, after(30 * DAY)), "not_found");
    assert.equal(getTask(3, db2), undefined);
  });

  it("期間を過ぎても、データ（タスク・コメント）は消さない", () => {
    const db = openDb();
    createComment({ taskId: 3, author: "suzuki", body: "残る" }, db);
    deleteTask(3, "sato", db, T0);
    restoreTask(3, "sato", db, after(40 * DAY));
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    assert.equal(n("SELECT COUNT(*) AS n FROM tasks WHERE id = 3"), 1);
    assert.equal(n("SELECT COUNT(*) AS n FROM comments WHERE task_id = 3"), 1);
  });
});

describe("元に戻す", () => {
  function attachAll(taskId: number, db: Db) {
    createComment({ taskId, author: "suzuki", body: "コメント" }, db);
    addTag(taskId, "急ぎ", db);
    createExtension({ taskId, requester: "sato", newDueDate: "2026-12-01", reason: "理由" }, db);
  }

  it("タスクとそのコメント・タグ・延長の申請が、削除する前と同じに見える（更新日時も変わらない）", () => {
    const db = openDb();
    attachAll(3, db);
    const task = getTask(3, db);
    const before = { comments: listComments(3, db), tags: listTags(3, db), extensions: listExtensions(3, db) };
    assert.equal(deleteTask(3, "sato", db, T0), "deleted");
    assert.equal(restoreTask(3, "sato", db, after(DAY)), "restored");
    assert.deepEqual(getTask(3, db), task);
    assert.deepEqual({ comments: listComments(3, db), tags: listTags(3, db), extensions: listExtensions(3, db) }, before);
    assert.ok(listTasks({}, db).some((t) => t.id === 3));
    const row = db.prepare("SELECT deleted_at, deleted_by FROM tasks WHERE id = 3").get() as { deleted_at: null; deleted_by: null };
    assert.deepEqual({ ...row }, { deleted_at: null, deleted_by: null });
  });

  it("担当者だけが戻せる。担当者以外は forbidden で、削除済みのまま", () => {
    const db = openDb();
    deleteTask(3, "sato", db, T0);
    for (const userId of ["tanaka", "suzuki", ""]) assert.equal(restoreTask(3, userId, db, T0), "forbidden", userId);
    assert.equal(getTask(3, db), undefined);
    assert.equal(restoreTask(3, "sato", db, T0), "restored");
  });

  it("担当者のいないタスクは、だれも戻せない", () => {
    const db = openDb();
    deleteTask(3, "sato", db, T0);
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("UPDATE tasks SET assignee = '' WHERE id = 3").run();
    db.exec("PRAGMA foreign_keys = ON");
    for (const userId of ["sato", ""]) assert.equal(restoreTask(3, userId, db, T0), "forbidden", userId);
  });

  it("削除していない・存在しない・もう戻したタスクは not_found。削除済みをもう一度消すのも not_found", () => {
    const db = openDb();
    assert.equal(restoreTask(3, "sato", db, T0), "not_found");
    assert.equal(restoreTask(9999, "sato", db, T0), "not_found");
    assert.equal(deleteTask(3, "sato", db, T0), "deleted");
    assert.equal(deleteTask(3, "sato", db, T0), "not_found");
    assert.equal(restoreTask(3, "sato", db, T0), "restored");
    assert.equal(restoreTask(3, "sato", db, T0), "not_found");
  });

  it("戻したタスクは、また消せて、削除の日時は新しく記録される", () => {
    const db = openDb();
    deleteTask(3, "sato", db, T0);
    restoreTask(3, "sato", db, T0);
    assert.equal(deleteTask(3, "sato", db, after(DAY)), "deleted");
    assert.equal(listDeletedTasks(db, after(DAY))[0].deletedAt, after(DAY).toISOString());
  });
});

describe("requestRestoreTask（削除したタスクの画面の元に戻すボタン）", () => {
  function fakeFetch(response: { ok: boolean; body?: unknown } | Error) {
    const calls: { url: string; method: string }[] = [];
    const fetch = async (url: string, init: { method: "POST" }) => {
      calls.push({ url, method: init.method });
      if (response instanceof Error) throw response;
      return { ok: response.ok, json: async () => response.body };
    };
    return { calls, fetch };
  }

  it("POST /api/tasks/:id/restore を 1 回送り、成功なら restored", async () => {
    const { calls, fetch } = fakeFetch({ ok: true, body: {} });
    assert.deepEqual(await requestRestoreTask(3, { fetch }), { status: "restored" });
    assert.deepEqual(calls, [{ url: "/api/tasks/3/restore", method: "POST" }]);
  });

  it("断られたら API のエラー文言を、通信に失敗したら決まった文言を返す", async () => {
    const forbidden = fakeFetch({ ok: false, body: { error: "このタスクを元に戻せるのは担当者だけです" } });
    assert.deepEqual(await requestRestoreTask(3, { fetch: forbidden.fetch }), { status: "error", message: "このタスクを元に戻せるのは担当者だけです" });
    const offline = fakeFetch(new Error("network"));
    assert.deepEqual(await requestRestoreTask(3, { fetch: offline.fetch }), { status: "error", message: "タスクを元に戻せませんでした。" });
  });
});
