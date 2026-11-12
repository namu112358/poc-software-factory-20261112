import { getDb, type Db } from "./db/index.ts";
import type { ValidationResult } from "./tasks.ts";

export type Comment = {
  id: number;
  taskId: number;
  author: string;
  authorName: string;
  body: string;
  createdAt: string; // ISO 8601（UTC）
};

type CommentRow = {
  id: number;
  task_id: number;
  author: string;
  author_name: string;
  body: string;
  created_at: string;
};

const SELECT =
  "SELECT c.id, c.task_id, c.author, u.name AS author_name, c.body, c.created_at FROM comments c JOIN users u ON u.id = c.author";

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    author: row.author,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export const COMMENT_MAX_LENGTH = 1000;

/** 投稿の本文を検証する。前後の空白を取り除き、1〜1000 文字でなければエラー。 */
export function validateCommentInput(body: unknown): ValidationResult<{ body: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const text = (body as Record<string, unknown>).body;
  if (typeof text !== "string") return { ok: false, errors: ["本文を文字列で入力してください"] };
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > COMMENT_MAX_LENGTH) {
    return { ok: false, errors: [`本文は 1〜${COMMENT_MAX_LENGTH} 文字で入力してください`] };
  }
  return { ok: true, value: { body: trimmed } };
}

/** タスクのコメントを投稿の古い順に返す。 */
export function listComments(taskId: number, db: Db = getDb()): Comment[] {
  const rows = db.prepare(`${SELECT} WHERE c.task_id = ? ORDER BY c.id`).all(taskId) as CommentRow[];
  return rows.map(toComment);
}

export function getComment(id: number, db: Db = getDb()): Comment | undefined {
  const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as CommentRow | undefined;
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

/** コメントを削除する。投稿者本人だけが削除できる。 */
export function deleteComment(taskId: number, commentId: number, userId: string, db: Db = getDb()): DeleteResult {
  const comment = getComment(commentId, db);
  if (!comment || comment.taskId !== taskId) return "not_found";
  if (comment.author !== userId) return "forbidden";
  db.prepare("DELETE FROM comments WHERE id = ?").run(commentId);
  return "deleted";
}

/** 複数のタスクについて、コメントした人の名前を、最初にコメントした古い順・重複なしでまとめて返す。コメントの無いタスクは含まない。 */
export function listCommentersByTask(taskIds: number[], db: Db = getDb()): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (taskIds.length === 0) return result;
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT c.task_id, u.name FROM comments c JOIN users u ON u.id = c.author WHERE c.task_id IN (${placeholders}) GROUP BY c.task_id, c.author ORDER BY MIN(c.id)`,
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
