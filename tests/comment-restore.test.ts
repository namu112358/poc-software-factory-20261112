// 削除したコメントを、30 日のあいだは書いた本人が元に戻せること（#445）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import {
  createComment,
  deleteComment,
  getComment,
  listCommentersByTask,
  listComments,
  listDeletedComments,
  restoreComment,
  updateComment,
} from "../src/lib/comments.ts";
import { deleteCommentConfirmMessage, requestRestoreComment } from "../src/lib/comment-delete.ts";
import { exportTasksCsv } from "../src/lib/export.ts";
import { listTasksByQuery } from "../src/lib/task-query.ts";
import { RESTORE_DAYS, deleteTask, listTasks, restoreTask } from "../src/lib/tasks.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-12T15:30:00.000Z"); // 日本時間 11/13 0:30（日付が UTC と変わる時刻）
const after = (ms: number) => new Date(T0.getTime() + ms);

/** タスク 3 に、佐藤・鈴木・佐藤の順で 3 件書き、真ん中以外も含めて返す。 */
function setup() {
  const db = openDb();
  const first = createComment({ taskId: 3, author: "sato", body: "一つ目" }, db, new Date("2026-11-10T00:00:00.000Z"));
  const middle = createComment({ taskId: 3, author: "suzuki", body: "先方と 12/1 納品で合意した" }, db, new Date("2026-11-11T00:00:00.000Z"));
  const last = createComment({ taskId: 3, author: "sato", body: "三つ目" }, db, new Date("2026-11-12T00:00:00.000Z"));
  return { db, first, middle, last };
}

describe("コメントを削除する", () => {
  it("コメント一覧から消え、「削除したコメント」に本文・書いた人・削除した日時が出る", () => {
    const { db, middle } = setup();
    assert.equal(deleteComment(3, middle.id, "suzuki", db, T0), "deleted");
    assert.deepEqual(listComments(3, db).map((c) => c.body), ["一つ目", "三つ目"]);
    assert.equal(getComment(middle.id, db), undefined);
    const deleted = listDeletedComments(3, db, T0);
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0].id, middle.id);
    assert.equal(deleted[0].body, "先方と 12/1 納品で合意した");
    assert.equal(deleted[0].authorName, "鈴木");
    assert.equal(deleted[0].deletedAt, T0.toISOString());
    assert.equal(deleted[0].restoreDeadline, after(RESTORE_DAYS * DAY).toISOString());
  });

  it("ほかのタスクの削除したコメントは出ない。削除していないタスクには何も出ない", () => {
    const { db, middle } = setup();
    const other = createComment({ taskId: 1, author: "sato", body: "別のタスク" }, db);
    deleteComment(1, other.id, "sato", db, T0);
    assert.deepEqual(listDeletedComments(3, db, T0), []);
    deleteComment(3, middle.id, "suzuki", db, T0);
    assert.deepEqual(listDeletedComments(3, db, T0).map((c) => c.id), [middle.id]);
  });

  it("削除済みのコメントをもう一度削除・編集すると not_found（ほかの画面で先に削除された場合）", () => {
    const { db, middle } = setup();
    deleteComment(3, middle.id, "suzuki", db, T0);
    assert.equal(deleteComment(3, middle.id, "suzuki", db, after(1000)), "not_found");
    assert.deepEqual(updateComment(3, middle.id, "suzuki", "書き換え", db), { status: "not_found" });
    assert.equal(listDeletedComments(3, db, T0)[0].deletedAt, T0.toISOString());
    assert.equal(listDeletedComments(3, db, T0)[0].body, "先方と 12/1 納品で合意した");
  });

  it("書いた本人でなければ削除できない", () => {
    const { db, middle } = setup();
    assert.equal(deleteComment(3, middle.id, "sato", db, T0), "forbidden");
    assert.equal(listComments(3, db).length, 3);
  });
});

describe("元に戻す", () => {
  it("本文・書いた人・書いた日時・編集した日時が削除の前と同じで、書いた日時の順の位置に戻る", () => {
    const { db, middle } = setup();
    updateComment(3, middle.id, "suzuki", "先方と 12/2 納品で合意した", db, new Date("2026-11-11T05:00:00.000Z"));
    const before = listComments(3, db);
    deleteComment(3, middle.id, "suzuki", db, T0);
    const result = restoreComment(3, middle.id, "suzuki", db, after(DAY));
    assert.equal(result.status, "restored");
    assert.deepEqual(result.status === "restored" && result.comment, before[1]);
    assert.deepEqual(listComments(3, db), before);
    assert.deepEqual(listDeletedComments(3, db, after(DAY)), []);
  });

  it("書いた本人でない人は forbidden で、コメントは削除したまま", () => {
    const { db, middle } = setup();
    deleteComment(3, middle.id, "suzuki", db, T0);
    for (const other of ["sato", "tanaka"]) {
      assert.deepEqual(restoreComment(3, middle.id, other, db, after(DAY)), { status: "forbidden" });
    }
    assert.equal(listComments(3, db).length, 2);
    assert.equal(listDeletedComments(3, db, after(DAY)).length, 1);
  });

  it("削除からちょうど 30 日では戻せず、「削除したコメント」にも出ない。その 1 ミリ秒前なら戻せる", () => {
    const { db, middle, last } = setup();
    deleteComment(3, middle.id, "suzuki", db, T0);
    deleteComment(3, last.id, "sato", db, T0);
    const deadline = after(RESTORE_DAYS * DAY);
    assert.deepEqual(listDeletedComments(3, db, deadline), []);
    assert.deepEqual(restoreComment(3, middle.id, "suzuki", db, deadline), { status: "not_found" });
    // 期間を過ぎたものは、本人でない人にも not_found（権限より先に、戻せるものが無いと返す）。
    assert.deepEqual(restoreComment(3, middle.id, "tanaka", db, deadline), { status: "not_found" });
    assert.equal(restoreComment(3, last.id, "sato", db, new Date(deadline.getTime() - 1)).status, "restored");
    assert.deepEqual(listComments(3, db).map((c) => c.body), ["一つ目", "三つ目"]);
  });

  it("削除していない・存在しない・別のタスクのコメントは not_found。戻したものをもう一度戻しても not_found", () => {
    const { db, first, middle } = setup();
    assert.deepEqual(restoreComment(3, first.id, "sato", db, T0), { status: "not_found" });
    assert.deepEqual(restoreComment(3, 9999, "sato", db, T0), { status: "not_found" });
    deleteComment(3, middle.id, "suzuki", db, T0);
    assert.deepEqual(restoreComment(1, middle.id, "suzuki", db, after(DAY)), { status: "not_found" });
    assert.equal(restoreComment(3, middle.id, "suzuki", db, after(DAY)).status, "restored");
    assert.deepEqual(restoreComment(3, middle.id, "suzuki", db, after(DAY)), { status: "not_found" });
  });

  it("戻したコメントは、また編集・削除できる", () => {
    const { db, middle } = setup();
    deleteComment(3, middle.id, "suzuki", db, T0);
    restoreComment(3, middle.id, "suzuki", db, after(DAY));
    assert.equal(updateComment(3, middle.id, "suzuki", "直した", db).status, "updated");
    assert.equal(deleteComment(3, middle.id, "suzuki", db, after(2 * DAY)), "deleted");
    assert.equal(listDeletedComments(3, db, after(2 * DAY))[0].body, "直した");
  });
});

describe("検索・コメントした人・件数", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("削除したコメントは、キーワード検索（画面・CSV・API）・コメントした人・件数に入らず、戻すとまた入る", () => {
    const { db, middle } = setup();
    const keyword = "納品で合意";
    const hit = () => ({
      screen: listTasks({ q: keyword, qInComments: true }, db).some((t) => t.id === 3),
      api: listTasksByQuery(q(`q=${encodeURIComponent(keyword)}`), db).some((t) => t.id === 3),
      csv: exportTasksCsv({ q: keyword }, db).split("\r\n").length > 2,
      commenters: listCommentersByTask([3], db).get(3)?.includes("鈴木") ?? false,
      count: listComments(3, db).length,
    });
    assert.deepEqual(hit(), { screen: true, api: true, csv: true, commenters: true, count: 3 });
    deleteComment(3, middle.id, "suzuki", db, T0);
    assert.deepEqual(hit(), { screen: false, api: false, csv: false, commenters: false, count: 2 });
    restoreComment(3, middle.id, "suzuki", db, after(DAY));
    assert.deepEqual(hit(), { screen: true, api: true, csv: true, commenters: true, count: 3 });
  });

  it("タスクのコメントをすべて削除すると、そのタスクはコメントした人の一覧に出ない", () => {
    const db = openDb();
    const c = createComment({ taskId: 3, author: "sato", body: "x" }, db);
    deleteComment(3, c.id, "sato", db, T0);
    assert.equal(listCommentersByTask([3], db).has(3), false);
  });
});

describe("タスクの削除と復元", () => {
  it("削除したコメントは削除したまま、削除していないコメントは戻る", () => {
    const { db, middle } = setup();
    deleteComment(3, middle.id, "suzuki", db, T0);
    const visible = listComments(3, db);
    assert.equal(deleteTask(3, "sato", db, after(DAY)), "deleted");
    assert.equal(restoreTask(3, "sato", db, after(2 * DAY)), "restored");
    assert.deepEqual(listComments(3, db), visible);
    assert.deepEqual(listDeletedComments(3, db, after(2 * DAY)).map((c) => c.id), [middle.id]);
    // コメントの期限は、コメントを削除した時刻から数える（タスクの削除と復元で延びない）。
    assert.deepEqual(listDeletedComments(3, db, after(RESTORE_DAYS * DAY)), []);
  });
});

describe("削除の確認の文言", () => {
  it("30 日のあいだは元に戻せることを伝え、「元に戻せません」とは出さない", () => {
    const m = deleteCommentConfirmMessage("先方と決めた納期");
    assert.ok(m.includes("30 日のあいだは元に戻せます"), m);
    assert.ok(!m.includes("元に戻せません"), m);
    assert.ok(m.includes("先方と決めた納期"));
  });
});

describe("requestRestoreComment", () => {
  it("戻す API に POST を送り、成功なら restored", async () => {
    const calls: { url: string; method: string }[] = [];
    const result = await requestRestoreComment(3, 7, async (url, init) => (calls.push({ url, method: init.method }), { ok: true, json: async () => ({}) }));
    assert.deepEqual(result, { status: "restored" });
    assert.deepEqual(calls, [{ url: "/api/tasks/3/comments/7/restore", method: "POST" }]);
  });

  it("断られたら API のエラーの文言、通信の失敗なら決まった文言を返す", async () => {
    const forbidden = await requestRestoreComment(3, 7, async () => ({ ok: false, json: async () => ({ error: "このコメントを元に戻せるのは書いた本人だけです" }) }));
    assert.deepEqual(forbidden, { status: "error", message: "このコメントを元に戻せるのは書いた本人だけです" });
    const broken = await requestRestoreComment(3, 7, async () => {
      throw new Error("offline");
    });
    assert.deepEqual(broken, { status: "error", message: "コメントを元に戻せませんでした。" });
  });
});
