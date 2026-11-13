import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { updateTasks } from "../src/lib/bulk-update.ts";
import { listComments, validateCommentInput } from "../src/lib/comments.ts";
import {
  createCommentOnce,
  createTaskOnce,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  parseIdempotencyKey,
  requestFingerprint,
  runIdempotent,
  type IdempotentResult,
} from "../src/lib/idempotency.ts";
import {
  completeTasks,
  createTask,
  deleteTask,
  duplicateTaskForRequest,
  getTask,
  restoreTask,
  updateTask,
  updateTaskIfUnchanged,
  validateTaskInput,
  type Task,
  type TaskInput,
} from "../src/lib/tasks.ts";

// 作成の API の Idempotency-Key（#528）。ルートは next/server を読み込むため単体テストから呼べない。
// ルートと同じ順（キーと本文の検証 → 誤りなら 400 で何もしない → キーつきの作成）で、src/lib の関数を呼んで確かめる。

const BODY = { title: "連携で作るタスク", status: "todo", assignee: "sato", dueDate: "2026-12-01" };
const T0 = new Date("2026-11-13T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function at(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

function taskCount(db: Db): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n);
}

function commentCount(db: Db): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM comments").get() as { n: number }).n);
}

type Response = { status: number; body: unknown };

function toResponse<T>(result: IdempotentResult<T>): Response {
  return result.kind === "conflict" ? { status: 409, body: null } : { status: result.status, body: result.body };
}

/** POST /api/tasks と同じ順。header は Idempotency-Key ヘッダーの値（無ければ null）。 */
function postTask(db: Db, user: string, header: string | null, body: unknown, now: Date = T0): Response {
  const key = parseIdempotencyKey(header);
  const input = validateTaskInput(body, {}, db);
  if (!key.ok || !input.ok) return { status: 400, body: null };
  return toResponse(createTaskOnce(user, key.value, body, input.value as TaskInput, db, now));
}

/** POST /api/tasks/:id/comments と同じ順。 */
function postComment(db: Db, user: string, taskId: number, header: string | null, body: unknown, now: Date = T0): Response {
  if (!getTask(taskId, db)) return { status: 404, body: null };
  const key = parseIdempotencyKey(header);
  const input = validateCommentInput(body);
  if (!key.ok || !input.ok) return { status: 400, body: null };
  return toResponse(createCommentOnce(user, key.value, taskId, body, input.value.body, db, now));
}

describe("POST /api/tasks の Idempotency-Key", () => {
  it("同じキーと同じ本文で 2 回送ると、タスクは 1 つだけで、2 回とも 201 と同じタスクを返す", () => {
    const db = openDb();
    const before = taskCount(db);
    const first = postTask(db, "sato", "key-1", BODY);
    const second = postTask(db, "sato", "key-1", BODY, at(1000));
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.deepEqual(second.body, first.body);
    assert.equal(taskCount(db), before + 1);
  });

  it("項目の順だけが違う本文は、同じ本文として扱う", () => {
    const db = openDb();
    const before = taskCount(db);
    const first = postTask(db, "sato", "key-1", BODY);
    const reordered = { dueDate: BODY.dueDate, assignee: BODY.assignee, status: BODY.status, title: BODY.title };
    const second = postTask(db, "sato", "key-1", reordered);
    assert.equal(second.status, 201);
    assert.deepEqual(second.body, first.body);
    assert.equal(taskCount(db), before + 1);
  });

  it("2 回目の前にタスクが更新されていても、1 回目と同じ本文を返し、新しく作らない", () => {
    const db = openDb();
    const first = postTask(db, "sato", "key-1", BODY);
    const id = (first.body as { task: Task }).task.id;
    updateTask(id, { title: "あとで直した" }, db);
    const before = taskCount(db);
    const second = postTask(db, "sato", "key-1", BODY);
    assert.deepEqual(second.body, first.body);
    assert.equal(taskCount(db), before);
  });

  it("作ったタスクを削除した後に送り直しても、新しく作らない", () => {
    const db = openDb();
    const first = postTask(db, "sato", "key-1", BODY);
    const id = (first.body as { task: Task }).task.id;
    assert.equal(deleteTask(id, "sato", db), "deleted");
    const before = taskCount(db);
    const second = postTask(db, "sato", "key-1", BODY);
    assert.equal(second.status, 201);
    assert.deepEqual(second.body, first.body);
    assert.equal(taskCount(db), before);
  });

  it("同じキーで本文が違うと 409 で断り、何も作らない", () => {
    const db = openDb();
    postTask(db, "sato", "key-1", BODY);
    const before = taskCount(db);
    const second = postTask(db, "sato", "key-1", { ...BODY, title: "別のタイトル" });
    assert.equal(second.status, 409);
    assert.equal(taskCount(db), before);
  });

  it("ほかの利用者が同じキーを使っても別のものとして扱い、ほかの人の結果を返さない", () => {
    const db = openDb();
    const sato = postTask(db, "sato", "shared-key", BODY);
    const before = taskCount(db);
    const suzuki = postTask(db, "suzuki", "shared-key", BODY);
    assert.equal(suzuki.status, 201);
    assert.equal(taskCount(db), before + 1);
    assert.notEqual((suzuki.body as { task: Task }).task.id, (sato.body as { task: Task }).task.id);
    // 本文が違っても、ほかの人のキーとはぶつからない（409 にしない）
    assert.equal(postTask(db, "tanaka", "shared-key", { ...BODY, title: "田中さんの" }).status, 201);
  });

  it("キーは 24 時間有効: 24 時間の 1 秒前までは 1 回目を返し、ちょうど 24 時間で新しい作成として扱う", () => {
    const db = openDb();
    const first = postTask(db, "sato", "key-1", BODY);
    const before = taskCount(db);
    const justBefore = postTask(db, "sato", "key-1", BODY, at(24 * HOUR - 1000));
    assert.deepEqual(justBefore.body, first.body);
    assert.equal(taskCount(db), before);
    const expired = postTask(db, "sato", "key-1", BODY, at(24 * HOUR));
    assert.equal(expired.status, 201);
    assert.equal(taskCount(db), before + 1);
    assert.notEqual((expired.body as { task: Task }).task.id, (first.body as { task: Task }).task.id);
    // 期限が切れた後に作ったものが、新しい 1 回目になる
    assert.deepEqual(postTask(db, "sato", "key-1", BODY, at(25 * HOUR)).body, expired.body);
  });

  it("期限が切れた後は、本文が違っても 409 にせず新しく作る", () => {
    const db = openDb();
    postTask(db, "sato", "key-1", BODY);
    const before = taskCount(db);
    assert.equal(postTask(db, "sato", "key-1", { ...BODY, title: "翌日の" }, at(24 * HOUR + 1)).status, 201);
    assert.equal(taskCount(db), before + 1);
  });

  it("期限切れの記録は、次にキーつきで書くときに消える", () => {
    const db = openDb();
    postTask(db, "sato", "old", BODY);
    postTask(db, "suzuki", "new", BODY, at(24 * HOUR));
    const keys = db.prepare("SELECT key FROM idempotency_keys ORDER BY key").all() as { key: string }[];
    assert.deepEqual(keys.map((k) => k.key), ["new"]);
  });

  it("キーを付けないときは、今までどおり送るたびに作る（画面からの作成も同じ）", () => {
    const db = openDb();
    const before = taskCount(db);
    const first = postTask(db, "sato", null, BODY);
    const second = postTask(db, "sato", null, BODY);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(taskCount(db), before + 2);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM idempotency_keys").get() as { n: number }).n), 0);
  });

  it("キーが空・長すぎる・空白や ASCII 以外を含むときは 400 で、何も作らない", () => {
    const db = openDb();
    const before = taskCount(db);
    for (const bad of ["", "a".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1), "key 1", "キー"]) {
      assert.equal(postTask(db, "sato", bad, BODY).status, 400, JSON.stringify(bad));
    }
    assert.equal(taskCount(db), before);
    assert.equal(postTask(db, "sato", "a".repeat(IDEMPOTENCY_KEY_MAX_LENGTH), BODY).status, 201);
  });

  it("入力に誤りがあって断った送信はキーに残らず、直して同じキーで送ると作られる", () => {
    const db = openDb();
    const before = taskCount(db);
    assert.equal(postTask(db, "sato", "key-1", { ...BODY, title: "" }).status, 400);
    assert.equal(taskCount(db), before);
    assert.equal(postTask(db, "sato", "key-1", BODY).status, 201);
    assert.equal(taskCount(db), before + 1);
  });

  it("同じキーの送信がほぼ同時に届いても、作られるのは 1 つ", async () => {
    const db = openDb();
    const before = taskCount(db);
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => postTask(db, "sato", "key-1", BODY)),
      Promise.resolve().then(() => postTask(db, "sato", "key-1", BODY)),
    ]);
    assert.deepEqual(a.body, b.body);
    assert.equal(taskCount(db), before + 1);
  });

  it("キーの記録に失敗したら、作ったタスクも残さない（全部か無しか）", () => {
    const db = openDb();
    const before = taskCount(db);
    assert.throws(() =>
      runIdempotent(
        { userId: "sato", scope: "tasks.create", key: "key-1", fingerprint: requestFingerprint(BODY) },
        () => ({ status: 201, body: { task: createTask(BODY as TaskInput, db), broken: BigInt(1) } }),
        db,
        T0,
      ),
    );
    assert.equal(taskCount(db), before);
    assert.equal(postTask(db, "sato", "key-1", BODY).status, 201);
    assert.equal(taskCount(db), before + 1);
  });
});

describe("POST /api/tasks/:id/comments の Idempotency-Key", () => {
  const COMMENT = { body: "確認しました" };

  it("同じキーと同じ本文で 2 回送ると、コメントは 1 つだけで、2 回とも 201 と同じコメントを返す", () => {
    const db = openDb();
    const before = commentCount(db);
    const first = postComment(db, "sato", 1, "c-1", COMMENT);
    const second = postComment(db, "sato", 1, "c-1", COMMENT, at(1000));
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.deepEqual(second.body, first.body);
    assert.equal(commentCount(db), before + 1);
  });

  it("同じキーで本文が違うと 409 で断り、何も投稿しない", () => {
    const db = openDb();
    postComment(db, "sato", 1, "c-1", COMMENT);
    const before = commentCount(db);
    assert.equal(postComment(db, "sato", 1, "c-1", { body: "別の本文" }).status, 409);
    assert.equal(commentCount(db), before);
  });

  it("同じキーで別のタスクに送ると、本文が違うものとして 409 で断る", () => {
    const db = openDb();
    postComment(db, "sato", 1, "c-1", COMMENT);
    const before = commentCount(db);
    assert.equal(postComment(db, "sato", 2, "c-1", COMMENT).status, 409);
    assert.equal(commentCount(db), before);
    assert.deepEqual(listComments(2, db), []);
  });

  it("ほかの利用者が同じキーを使っても、別のコメントとして投稿され、投稿者はその人になる", () => {
    const db = openDb();
    postComment(db, "sato", 1, "c-1", COMMENT);
    const suzuki = postComment(db, "suzuki", 1, "c-1", COMMENT);
    assert.equal(suzuki.status, 201);
    assert.equal((suzuki.body as { comment: { author: string } }).comment.author, "suzuki");
    assert.equal(listComments(1, db).length, 2);
  });

  it("キーは 24 時間有効。過ぎたあとは新しい投稿として扱う", () => {
    const db = openDb();
    postComment(db, "sato", 1, "c-1", COMMENT);
    const before = commentCount(db);
    postComment(db, "sato", 1, "c-1", COMMENT, at(24 * HOUR - 1000));
    assert.equal(commentCount(db), before);
    assert.equal(postComment(db, "sato", 1, "c-1", COMMENT, at(24 * HOUR)).status, 201);
    assert.equal(commentCount(db), before + 1);
  });

  it("キーを付けないときは、今までどおり送るたびに投稿する", () => {
    const db = openDb();
    const before = commentCount(db);
    postComment(db, "sato", 1, null, COMMENT);
    postComment(db, "sato", 1, null, COMMENT);
    assert.equal(commentCount(db), before + 2);
  });

  it("同じキーをタスクの作成とコメントの投稿で使っても、別のものとして扱う", () => {
    const db = openDb();
    assert.equal(postTask(db, "sato", "same", BODY).status, 201);
    assert.equal(postComment(db, "sato", 1, "same", COMMENT).status, 201);
  });

  it("タスクが無ければ 404 で、キーに残さない", () => {
    const db = openDb();
    assert.equal(postComment(db, "sato", 9999, "c-1", COMMENT).status, 404);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM idempotency_keys").get() as { n: number }).n), 0);
  });
});

describe("タスクを返す書き込みの応答に updatedAt が入る", () => {
  function assertHasUpdatedAt(task: Task | undefined): void {
    assert.ok(task, "タスクが返るはず");
    assert.equal(typeof task.updatedAt, "string");
    assert.ok(!Number.isNaN(Date.parse(task.updatedAt)), task.updatedAt);
  }

  it("作成（キーあり・なし）", () => {
    const db = openDb();
    assertHasUpdatedAt((postTask(db, "sato", "k", BODY).body as { task: Task }).task);
    assertHasUpdatedAt((postTask(db, "sato", null, BODY).body as { task: Task }).task);
  });

  it("更新（確かめあり・なし）", () => {
    const db = openDb();
    assertHasUpdatedAt(updateTask(1, { memo: "a" }, db));
    const r = updateTaskIfUnchanged(1, { memo: "b" }, getTask(1, db)!.updatedAt, db);
    assert.ok(r.ok);
    assertHasUpdatedAt(r.task);
  });

  it("まとめての変更・まとめての完了", () => {
    const db = openDb();
    const updated = updateTasks([1, 2], { status: "in_progress" }, db);
    assert.ok(updated.ok);
    updated.tasks.forEach(assertHasUpdatedAt);
    const completed = completeTasks([1, 2], db);
    assert.ok(completed.ok);
    completed.tasks.forEach(assertHasUpdatedAt);
  });

  it("複製・元に戻す", () => {
    const db = openDb();
    const dup = duplicateTaskForRequest(1, db);
    assert.ok(dup.ok);
    assertHasUpdatedAt(dup.task);
    assert.equal(deleteTask(1, "sato", db), "deleted");
    assert.equal(restoreTask(1, "sato", db), "restored");
    assertHasUpdatedAt(getTask(1, db));
  });
});
