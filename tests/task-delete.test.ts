import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createComment, listComments } from "../src/lib/comments.ts";
import { createExtension, listExtensions } from "../src/lib/extensions.ts";
import { addTag, listTags } from "../src/lib/tags.ts";
import { confirmAndDeleteTask } from "../src/lib/task-delete.ts";
import { deleteTask, getTask, updateTask } from "../src/lib/tasks.ts";

// シードのタスク 3 は sato が担当（進行中）、タスク 1 は sato が担当（完了）、タスク 4 は tanaka が担当。

/** タスクにコメント・タグ・延長の申請を 1 つずつ付ける。 */
function attachAll(taskId: number, db: ReturnType<typeof openDb>) {
  createComment({ taskId, author: "suzuki", body: "コメント" }, db);
  addTag(taskId, "急ぎ", db);
  createExtension({ taskId, requester: "sato", newDueDate: "2026-12-01", reason: "理由" }, db);
}

function attachedCounts(taskId: number, db: ReturnType<typeof openDb>) {
  return { comments: listComments(taskId, db).length, tags: listTags(taskId, db).length, extensions: listExtensions(taskId, db).length };
}

describe("deleteTask", () => {
  it("担当者が消すと deleted で、以後そのタスクは取得できない", () => {
    const db = openDb();
    assert.equal(deleteTask(3, "sato", db), "deleted");
    assert.equal(getTask(3, db), undefined);
  });

  it("担当者以外が消そうとすると forbidden で、タスクと付いているものは残る", () => {
    const db = openDb();
    attachAll(3, db);
    const before = getTask(3, db);
    assert.equal(deleteTask(3, "tanaka", db), "forbidden");
    assert.deepEqual(getTask(3, db), before);
    assert.deepEqual(attachedCounts(3, db), { comments: 1, tags: 1, extensions: 1 });
  });

  it("コメント・タグ・延長の申請は消さずに残し（元に戻すため）、ほかのタスクのものも変わらない", () => {
    const db = openDb();
    attachAll(3, db);
    attachAll(4, db);
    assert.equal(deleteTask(3, "sato", db), "deleted");
    for (const table of ["comments", "task_tags", "due_date_extensions"]) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE task_id = ?`).get(3) as { n: number };
      assert.equal(row.n, 1, table);
    }
    assert.deepEqual(attachedCounts(4, db), { comments: 1, tags: 1, extensions: 1 });
  });

  it("消すと、削除した日時と削除した人を記録する", () => {
    const db = openDb();
    const now = new Date("2026-11-12T03:00:00.000Z");
    assert.equal(deleteTask(3, "sato", db, now), "deleted");
    const row = db.prepare("SELECT deleted_at, deleted_by FROM tasks WHERE id = 3").get() as { deleted_at: string; deleted_by: string };
    assert.deepEqual({ ...row }, { deleted_at: "2026-11-12T03:00:00.000Z", deleted_by: "sato" });
  });

  it("存在しないタスク・消したばかりのタスクは not_found", () => {
    const db = openDb();
    assert.equal(deleteTask(9999, "sato", db), "not_found");
    assert.equal(deleteTask(3, "sato", db), "deleted");
    assert.equal(deleteTask(3, "sato", db), "not_found");
  });

  it("完了済み・アーカイブ済みのタスクも、担当者なら消せる", () => {
    const db = openDb();
    assert.equal(getTask(1, db)?.status, "done");
    assert.equal(deleteTask(1, "sato", db), "deleted");
    updateTask(6, { archived: true }, db);
    assert.equal(deleteTask(6, getTask(6, db)!.assignee, db), "deleted");
  });

  it("担当者のいないタスクは、だれが消そうとしても forbidden で残る（空の利用者 ID でも消えない）", () => {
    const db = openDb();
    // 今の検証では担当者を空にできないため、外部キーの確認を止めて直接書き込む。
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("UPDATE tasks SET assignee = '' WHERE id = 3").run();
    db.exec("PRAGMA foreign_keys = ON");
    for (const userId of ["sato", "tanaka", ""]) assert.equal(deleteTask(3, userId, db), "forbidden", userId);
    assert.ok(getTask(3, db));
  });

  it("担当者が変わった後は、前の担当者は消せず、新しい担当者が消せる", () => {
    const db = openDb();
    updateTask(3, { assignee: "tanaka" }, db);
    assert.equal(deleteTask(3, "sato", db), "forbidden");
    assert.equal(deleteTask(3, "tanaka", db), "deleted");
  });
});

describe("confirmAndDeleteTask（詳細画面の削除ボタン）", () => {
  function fakeFetch(response: { ok: boolean; body?: unknown } | Error) {
    const calls: { url: string; method: string }[] = [];
    const fetch = async (url: string, init: { method: "DELETE" }) => {
      calls.push({ url, method: init.method });
      if (response instanceof Error) throw response;
      return { ok: response.ok, json: async () => response.body };
    };
    return { calls, fetch };
  }

  it("確認のダイアログでキャンセルすると、何も送らない", async () => {
    const { calls, fetch } = fakeFetch({ ok: true });
    const messages: string[] = [];
    const result = await confirmAndDeleteTask(3, "API 設計", { confirm: (m) => (messages.push(m), false), fetch });
    assert.deepEqual(result, { status: "cancelled" });
    assert.equal(calls.length, 0);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /API 設計/);
    assert.match(messages[0], /30 日/);
  });

  it("OK すると DELETE /api/tasks/:id を 1 回送り、成功なら deleted", async () => {
    const { calls, fetch } = fakeFetch({ ok: true, body: { ok: true } });
    assert.deepEqual(await confirmAndDeleteTask(3, "x", { confirm: () => true, fetch }), { status: "deleted" });
    assert.deepEqual(calls, [{ url: "/api/tasks/3", method: "DELETE" }]);
  });

  it("断られたら API のエラー文言を、通信に失敗したら決まった文言を返す", async () => {
    const forbidden = fakeFetch({ ok: false, body: { error: "このタスクを削除できるのは担当者だけです" } });
    assert.deepEqual(await confirmAndDeleteTask(3, "x", { confirm: () => true, fetch: forbidden.fetch }), {
      status: "error",
      message: "このタスクを削除できるのは担当者だけです",
    });
    const offline = fakeFetch(new Error("network"));
    assert.deepEqual(await confirmAndDeleteTask(3, "x", { confirm: () => true, fetch: offline.fetch }), {
      status: "error",
      message: "タスクを削除できませんでした。",
    });
  });
});
