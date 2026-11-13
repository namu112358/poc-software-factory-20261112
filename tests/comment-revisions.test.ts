// コメントを編集したとき、編集の前の本文と編集した日時が残り、タスクの詳細で見られること（#447）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, migrate } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { DatabaseSync } from "node:sqlite";
import {
  createComment,
  deleteComment,
  getComment,
  listCommentRevisions,
  listComments,
  restoreComment,
  updateComment,
  validateCommentInput,
} from "../src/lib/comments.ts";
import { createTask, listTasks } from "../src/lib/tasks.ts";

const created = new Date("2026-11-09T03:00:00.000Z");
const t1 = new Date("2026-11-10T04:00:00.000Z");
const t2 = new Date("2026-11-12T15:30:00.000Z"); // 日本時間 11/13 0:30（日付が UTC と変わる時刻）
const t3 = new Date("2026-11-13T01:00:00.000Z");

/** API の PATCH と同じ順で、本文を検証してから編集する。 */
function editLikeApi(db: ReturnType<typeof openDb>, taskId: number, commentId: number, userId: string, raw: unknown, now: Date) {
  const input = validateCommentInput(raw);
  assert.equal(input.ok, true);
  return updateComment(taskId, commentId, userId, input.ok ? input.value.body : "", db, now);
}

describe("編集の前の本文を残す", () => {
  it("編集すると、前の本文と編集した日時が残り、タスクのコメントごとに読める", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "納期は 12/1" }, db, created);
    updateComment(1, c.id, "sato", "納期は 12/5", db, t1);
    assert.deepEqual(listCommentRevisions(1, db).get(c.id), [{ body: "納期は 12/1", editedAt: "2026-11-10T04:00:00.000Z" }]);
    assert.equal(getComment(c.id, db)?.body, "納期は 12/5");
  });

  it("残した日時は、コメントの「編集済み」の日時と同じ", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "一" }, db, created);
    updateComment(1, c.id, "sato", "二", db, t2);
    assert.equal(listCommentRevisions(1, db).get(c.id)?.[0].editedAt, getComment(c.id, db)?.editedAt);
  });

  it("何度か編集すると、編集した日時の古い順にすべて残る", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "一" }, db, created);
    updateComment(1, c.id, "sato", "二", db, t1);
    updateComment(1, c.id, "sato", "三", db, t2);
    updateComment(1, c.id, "sato", "四", db, t3);
    assert.deepEqual(listCommentRevisions(1, db).get(c.id), [
      { body: "一", editedAt: t1.toISOString() },
      { body: "二", editedAt: t2.toISOString() },
      { body: "三", editedAt: t3.toISOString() },
    ]);
  });

  it("同じ時刻の編集が続いても、編集した順に並ぶ", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "一" }, db, created);
    updateComment(1, c.id, "sato", "二", db, t1);
    updateComment(1, c.id, "sato", "三", db, t1);
    assert.deepEqual(listCommentRevisions(1, db).get(c.id)?.map((r) => r.body), ["一", "二"]);
  });

  it("元の本文に戻す編集も 1 回として残る（行って戻る）", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "A" }, db, created);
    updateComment(1, c.id, "sato", "B", db, t1);
    updateComment(1, c.id, "sato", "A", db, t2);
    assert.deepEqual(listCommentRevisions(1, db).get(c.id)?.map((r) => r.body), ["A", "B"]);
    assert.equal(getComment(c.id, db)?.body, "A");
  });

  it("コメントごと・タスクごとに分かれ、編集していないコメントは含まない", () => {
    const db = openDb();
    const a = createComment({ taskId: 1, author: "sato", body: "a1" }, db, created);
    const b = createComment({ taskId: 1, author: "suzuki", body: "b1" }, db, created);
    const other = createComment({ taskId: 2, author: "sato", body: "x1" }, db, created);
    updateComment(1, a.id, "sato", "a2", db, t1);
    updateComment(2, other.id, "sato", "x2", db, t1);
    const revisions = listCommentRevisions(1, db);
    assert.deepEqual([...revisions.keys()], [a.id]);
    assert.equal(revisions.has(b.id), false);
    assert.deepEqual(listCommentRevisions(2, db).get(other.id)?.map((r) => r.body), ["x1"]);
    assert.equal(listCommentRevisions(3, db).size, 0);
  });
});

describe("本文を変えずに保存したときは残さない", () => {
  it("今と同じ本文なら残さず、「編集済み」も付かない", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "同じ" }, db, created);
    assert.equal(updateComment(1, c.id, "sato", "同じ", db, t1).status, "updated");
    assert.equal(listCommentRevisions(1, db).size, 0);
    assert.equal(getComment(c.id, db)?.editedAt, null);
  });

  it("前後の空白だけ違う本文は、検証で取り除かれて同じになり、残さない", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "同じ" }, db, created);
    editLikeApi(db, 1, c.id, "sato", { body: "  同じ\n" }, t1);
    assert.equal(listCommentRevisions(1, db).size, 0);
  });

  it("一度編集した後に同じ本文で保存しても、増えず、編集日時も前のまま", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "一" }, db, created);
    updateComment(1, c.id, "sato", "二", db, t1);
    updateComment(1, c.id, "sato", "二", db, t2);
    assert.equal(listCommentRevisions(1, db).get(c.id)?.length, 1);
    assert.equal(getComment(c.id, db)?.editedAt, t1.toISOString());
  });

  it("大文字・小文字だけ違う本文は別の本文として残す", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "abc" }, db, created);
    updateComment(1, c.id, "sato", "ABC", db, t1);
    assert.deepEqual(listCommentRevisions(1, db).get(c.id)?.map((r) => r.body), ["abc"]);
  });
});

describe("断られた編集では、前の本文を残さない（全部か無しか）", () => {
  it("他人のコメント・別のタスクのコメント・存在しないコメント", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "元の本文" }, db, created);
    assert.equal(updateComment(1, c.id, "suzuki", "乗っ取り", db, t1).status, "forbidden");
    assert.equal(updateComment(2, c.id, "sato", "別のタスク", db, t1).status, "not_found");
    assert.equal(updateComment(1, 999, "sato", "無い", db, t1).status, "not_found");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comment_revisions").get()?.n, 0);
    assert.equal(getComment(c.id, db)?.body, "元の本文");
  });

  it("削除したコメントは編集できず、前の本文も増えない", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "一" }, db, created);
    updateComment(1, c.id, "sato", "二", db, t1);
    deleteComment(1, c.id, "sato", db, t2);
    assert.equal(updateComment(1, c.id, "sato", "三", db, t3).status, "not_found");
    assert.equal(listCommentRevisions(1, db).get(c.id)?.length, 1);
  });

  it("本文の書き換えに失敗したら、前の本文の記録も戻る", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "一" }, db, created);
    db.exec("CREATE TRIGGER fail_update BEFORE UPDATE OF body ON comments BEGIN SELECT RAISE(ABORT, 'boom'); END");
    assert.throws(() => updateComment(1, c.id, "sato", "二", db, t1), /boom/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comment_revisions").get()?.n, 0);
    assert.equal(getComment(c.id, db)?.body, "一");
  });
});

describe("ほかの操作との関わり", () => {
  it("削除して元に戻したコメントは、前の本文がそのまま残っている", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "一" }, db, created);
    updateComment(1, c.id, "sato", "二", db, t1);
    deleteComment(1, c.id, "sato", db, t2);
    assert.equal(restoreComment(1, c.id, "sato", db, t3).status, "restored");
    assert.deepEqual(listCommentRevisions(1, db).get(c.id), [{ body: "一", editedAt: t1.toISOString() }]);
  });

  it("削除している間は、詳細に出すコメントの一覧に含まれない（前の本文も出ない）", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "一" }, db, created);
    updateComment(1, c.id, "sato", "二", db, t1);
    deleteComment(1, c.id, "sato", db, t2);
    assert.deepEqual(listComments(1, db).filter((x) => listCommentRevisions(1, db).has(x.id)), []);
  });

  it("前の本文は、コメントの本文の検索に当たらない（今の本文だけで探す）", () => {
    const db = openDb();
    const t = createTask({ title: "履歴検索用", status: "todo", assignee: "sato", dueDate: "", priority: "low", memo: "" }, db);
    const c = createComment({ taskId: t.id, author: "sato", body: "旧い固有語" }, db, created);
    updateComment(t.id, c.id, "sato", "新しい本文", db, t1);
    assert.deepEqual(listTasks({ q: "旧い固有語", qInComments: true }, db).map((x) => x.id), []);
    assert.deepEqual(listTasks({ q: "新しい本文", qInComments: true }, db).map((x) => x.id), [t.id]);
  });

  it("タスクの行を消すと、コメントと一緒に前の本文も消える", () => {
    const db = openDb();
    const t = createTask({ title: "消す", status: "todo", assignee: "sato", dueDate: "", priority: "low", memo: "" }, db);
    const c = createComment({ taskId: t.id, author: "sato", body: "一" }, db, created);
    updateComment(t.id, c.id, "sato", "二", db, t1);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(t.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comment_revisions").get()?.n, 0);
  });
});

describe("API で編集したとき（PATCH と同じ検証と判定）", () => {
  it("API の手順で編集しても前の本文が残り、応答のコメントの形は変わらない", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "API 前" }, db, created);
    const result = editLikeApi(db, 1, c.id, "sato", { body: "API 後" }, t1);
    assert.equal(result.status, "updated");
    assert.deepEqual(Object.keys(result.status === "updated" ? result.comment : {}).sort(), [
      "author",
      "authorName",
      "body",
      "createdAt",
      "editedAt",
      "id",
      "taskId",
    ]);
    assert.deepEqual(listCommentRevisions(1, db).get(c.id)?.map((r) => r.body), ["API 前"]);
  });
});

describe("マイグレーション 25", () => {
  it("24 までの DB に足すと、既存のコメントは残り、履歴は空から始まる", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db, MIGRATIONS.filter((m) => m.version <= 24));
    db.exec("INSERT INTO users (id, name, password_hash) VALUES ('u', 'U', 'x')");
    db.exec("INSERT INTO tasks (title, status, assignee, due_date, created_at, updated_at) VALUES ('t', 'todo', 'u', '', '2026-01-01', '2026-01-01')");
    db.exec("INSERT INTO comments (task_id, author, body, created_at, edited_at) VALUES (1, 'u', '既存', '2026-01-01', '2026-01-02')");
    migrate(db);
    assert.equal(listComments(1, db)[0].body, "既存");
    assert.equal(listCommentRevisions(1, db).size, 0);
  });
});
