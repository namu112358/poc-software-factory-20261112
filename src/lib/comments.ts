import { getDb, transaction, type Db } from "./db/index.ts";
import { restoreCutoff, restoreDeadline } from "./task-store.ts";
import type { ValidationResult } from "./tasks.ts";
import { checkBodyFields } from "./body-fields.ts";

export type Comment = {
  id: number;
  taskId: number;
  author: string;
  authorName: string;
  body: string;
  createdAt: string; // ISO 8601（UTC）
  editedAt: string | null; // 最後に本文を編集した日時。ISO 8601（UTC）。未編集なら null
};

type CommentRow = {
  id: number;
  task_id: number;
  author: string;
  author_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
};

const COLUMNS =
  "SELECT c.id, c.task_id, c.author, u.name AS author_name, c.body, c.created_at, c.edited_at FROM comments c JOIN users u ON u.id = c.author";
// 削除していないコメントだけ。一覧・検索・編集の対象はこれ。
const SELECT = `${COLUMNS} WHERE c.deleted_at IS NULL`;

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    author: row.author,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

export const COMMENT_MAX_LENGTH = 1000;

/** 投稿・編集の本文を検証する。前後の空白を取り除き、1〜1000 文字でなければエラー。`body` のほかの項目があれば誤り（#527）。 */
export function validateCommentInput(body: unknown): ValidationResult<{ body: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  return checkBodyFields(body as Record<string, unknown>, ["body"], ({ body: text }) => {
    if (typeof text !== "string") return { ok: false, errors: ["本文を文字列で入力してください"] };
    const trimmed = text.trim();
    if (trimmed.length < 1 || trimmed.length > COMMENT_MAX_LENGTH) {
      return { ok: false, errors: [`本文は 1〜${COMMENT_MAX_LENGTH} 文字で入力してください`] };
    }
    return { ok: true, value: { body: trimmed } };
  });
}

/** タスクのコメント（削除したものを除く）を投稿の古い順に返す。 */
export function listComments(taskId: number, db: Db = getDb()): Comment[] {
  const rows = db.prepare(`${SELECT} AND c.task_id = ? ORDER BY c.created_at, c.id`).all(taskId) as CommentRow[];
  return rows.map(toComment);
}

/** 削除していないコメントを 1 件返す。削除したコメントは undefined。 */
export function getComment(id: number, db: Db = getDb()): Comment | undefined {
  const row = db.prepare(`${SELECT} AND c.id = ?`).get(id) as CommentRow | undefined;
  return row && toComment(row);
}

export function createComment(
  input: { taskId: number; author: string; body: string },
  db: Db = getDb(),
  now: Date = new Date(),
): Comment {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)")
    .run(input.taskId, input.author, input.body, now.toISOString());
  return getComment(Number(lastInsertRowid), db)!;
}

export type DeleteResult = "deleted" | "not_found" | "forbidden";

/**
 * コメントを削除する。投稿者本人だけが削除できる。行は残して削除した日時を記録し、一覧・検索から見えなくする
 * （RESTORE_DAYS 日のあいだは `restoreComment` で戻せる）。削除済みのコメントをもう一度消そうとすると not_found。
 * 判定と書き込みを 1 つの文で行い、読んでから書くまでにほかの操作が入っても、他人のコメントを消さない。
 */
export function deleteComment(
  taskId: number,
  commentId: number,
  userId: string,
  db: Db = getDb(),
  now: Date = new Date(),
): DeleteResult {
  const { changes } = db
    .prepare("UPDATE comments SET deleted_at = ? WHERE id = ? AND task_id = ? AND author = ? AND deleted_at IS NULL")
    .run(now.toISOString(), commentId, taskId, userId);
  if (Number(changes) > 0) return "deleted";
  const comment = getComment(commentId, db);
  if (!comment || comment.taskId !== taskId) return "not_found";
  return "forbidden";
}

export type DeletedComment = {
  id: number;
  taskId: number;
  author: string; // 書いた人の ID（元に戻せるのはこの人だけ）
  authorName: string;
  body: string;
  createdAt: string; // ISO 8601（UTC）
  deletedAt: string; // ISO 8601（UTC）
  restoreDeadline: string; // 元に戻せる最後の時刻。ISO 8601（UTC）
};

/** `now` の時点で元に戻せる（削除してから RESTORE_DAYS 日たっていない）、タスクの削除したコメント。削除した日時の新しい順（同じなら ID の大きい順）。 */
export function listDeletedComments(taskId: number, db: Db = getDb(), now: Date = new Date()): DeletedComment[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.task_id, c.author, u.name AS author_name, c.body, c.created_at, c.deleted_at
         FROM comments c JOIN users u ON u.id = c.author
        WHERE c.task_id = ? AND c.deleted_at IS NOT NULL AND c.deleted_at > ?
        ORDER BY c.deleted_at DESC, c.id DESC`,
    )
    .all(taskId, restoreCutoff(now)) as (Omit<CommentRow, "edited_at"> & { deleted_at: string })[];
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    author: r.author,
    authorName: r.author_name,
    body: r.body,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
    restoreDeadline: restoreDeadline(r.deleted_at),
  }));
}

export type RestoreCommentResult = { status: "restored"; comment: Comment } | { status: "not_found" } | { status: "forbidden" };

/**
 * 削除したコメントを元に戻す。戻せるのは、削除してから RESTORE_DAYS 日たっていないコメントを書いた本人だけ。
 * 削除していない・期間を過ぎた・別のタスクの・存在しないコメントは not_found。戻したコメントは、本文・書いた日時・編集した日時が削除の前のまま。
 * 期間と本人の確認と書き込みは 1 つの UPDATE 文の条件で行う。
 */
export function restoreComment(
  taskId: number,
  commentId: number,
  userId: string,
  db: Db = getDb(),
  now: Date = new Date(),
): RestoreCommentResult {
  const cutoff = restoreCutoff(now);
  const { changes } = db
    .prepare("UPDATE comments SET deleted_at = NULL WHERE id = ? AND task_id = ? AND author = ? AND deleted_at IS NOT NULL AND deleted_at > ?")
    .run(commentId, taskId, userId, cutoff);
  if (Number(changes) > 0) return { status: "restored", comment: getComment(commentId, db)! };
  const restorable = db
    .prepare("SELECT 1 FROM comments WHERE id = ? AND task_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?")
    .get(commentId, taskId, cutoff);
  return restorable ? { status: "forbidden" } : { status: "not_found" };
}

export type UpdateCommentResult =
  | { status: "updated"; comment: Comment }
  | { status: "not_found" }
  | { status: "forbidden" };

/**
 * コメントの本文を書き換え、編集日時を記録する。投稿者本人だけが編集できる（削除と同じ判定）。
 * 別のタスクのコメントは、だれが指定しても not_found。本文が今と同じなら、編集日時は変えず、前の本文も残さない。
 * 本文が変わるときは、編集の前の本文を `comment_revisions` に残す（`listCommentRevisions` で読む）。
 * body は validateCommentInput を通した値を渡す。
 */
export function updateComment(
  taskId: number,
  commentId: number,
  userId: string,
  body: string,
  db: Db = getDb(),
  now: Date = new Date(),
): UpdateCommentResult {
  const params = { body, now: now.toISOString(), id: commentId, taskId, userId };
  // 判定と書き込みを同じ条件の文で行い、読んでから書くまでに削除などが入っても、他人のコメントを書き換えない。
  // 前の本文の記録と本文の書き換えは 1 つのトランザクションで行い、片方だけが起きないようにする。
  const changes = transaction(db, () => {
    db.prepare(
      "INSERT INTO comment_revisions (comment_id, body, edited_at) SELECT id, body, :now FROM comments WHERE id = :id AND task_id = :taskId AND author = :userId AND deleted_at IS NULL AND body <> :body",
    ).run(params);
    return Number(
      db
        .prepare(
          "UPDATE comments SET edited_at = CASE WHEN body = :body THEN edited_at ELSE :now END, body = :body WHERE id = :id AND task_id = :taskId AND author = :userId AND deleted_at IS NULL",
        )
        .run(params).changes,
    );
  });
  if (changes === 0) {
    const comment = getComment(commentId, db);
    if (!comment || comment.taskId !== taskId) return { status: "not_found" };
    return { status: "forbidden" };
  }
  return { status: "updated", comment: getComment(commentId, db)! };
}

export type CommentRevision = {
  body: string; // 編集の前の本文
  editedAt: string; // この本文を書き換えた日時。ISO 8601（UTC）
};

/**
 * タスクのコメントごとの、編集の前の本文を、編集した日時の古い順（同じなら編集した順）で返す。
 * 削除したコメントの分も含む（戻したときにそのまま出せるように）。編集していないコメントは含まない。
 */
export function listCommentRevisions(taskId: number, db: Db = getDb()): Map<number, CommentRevision[]> {
  const rows = db
    .prepare(
      `SELECT r.comment_id, r.body, r.edited_at FROM comment_revisions r JOIN comments c ON c.id = r.comment_id
        WHERE c.task_id = ? ORDER BY r.comment_id, r.edited_at, r.id`,
    )
    .all(taskId) as { comment_id: number; body: string; edited_at: string }[];
  const result = new Map<number, CommentRevision[]>();
  for (const r of rows) {
    const list = result.get(r.comment_id) ?? [];
    list.push({ body: r.body, editedAt: r.edited_at });
    result.set(r.comment_id, list);
  }
  return result;
}

/** 詳細画面で、日時の隣に出す編集の印。未編集なら空文字。 */
export function commentEditedLabel(comment: Pick<Comment, "editedAt">): string {
  return comment.editedAt === null ? "" : "（編集済み）";
}

/** 複数のタスクについて、コメントした人の名前を、最初にコメントした古い順・重複なしでまとめて返す。削除したコメントは数えない。コメントの無いタスクは含まない。 */
export function listCommentersByTask(taskIds: number[], db: Db = getDb()): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (taskIds.length === 0) return result;
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT c.task_id, u.name FROM comments c JOIN users u ON u.id = c.author WHERE c.deleted_at IS NULL AND c.task_id IN (${placeholders}) GROUP BY c.task_id, c.author ORDER BY MIN(c.id)`,
    )
    .all(...taskIds) as { task_id: number; name: string }[];
  for (const r of rows) {
    const names = result.get(r.task_id) ?? [];
    names.push(r.name);
    result.set(r.task_id, names);
  }
  return result;
}

export type CommentPart = { type: "text"; text: string } | { type: "link"; url: string };

// http:// か https:// で始まり、ASCII の印字文字（空白・日本語・< > " ' を除く）が続くものを URL とみなす。
const URL_PATTERN = /https?:\/\/[\x21\x23-\x26\x28-\x3b\x3d\x3f-\x7e]+/gi;
// 文の区切りとして付いた末尾の記号は URL に含めない。
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** コメントの本文を、文字の部分と http(s) の URL の部分に分ける。URL 以外の文字（改行を含む）はそのまま text に入れる。 */
export function splitCommentBody(body: string): CommentPart[] {
  const parts: CommentPart[] = [];
  let last = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    if (!/^https?:\/\/./i.test(url)) continue;
    if (match.index > last) parts.push({ type: "text", text: body.slice(last, match.index) });
    parts.push({ type: "link", url });
    last = match.index + url.length;
  }
  if (last < body.length) parts.push({ type: "text", text: body.slice(last) });
  return parts;
}
