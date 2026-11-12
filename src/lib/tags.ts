import { getDb, type Db } from "./db/index.ts";
import type { ValidationResult } from "./tasks.ts";

export const TAG_MAX_LENGTH = 20;

/** タグの名前を検証する。前後の空白を取り除き、1〜20 文字で、空白・`,`・`/` を含まなければ有効。 */
export function validateTagInput(body: unknown): ValidationResult<{ name: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const name = (body as Record<string, unknown>).name;
  if (typeof name !== "string") return { ok: false, errors: ["タグの名前を文字列で入力してください"] };
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > TAG_MAX_LENGTH) {
    return { ok: false, errors: [`タグの名前は 1〜${TAG_MAX_LENGTH} 文字で入力してください`] };
  }
  if (/[\s,/]/.test(trimmed)) {
    return { ok: false, errors: ["タグの名前に空白・カンマ（,）・スラッシュ（/）は使えません"] };
  }
  return { ok: true, value: { name: trimmed } };
}

/** タスクのタグを、付けた古い順に返す。 */
export function listTags(taskId: number, db: Db = getDb()): string[] {
  const rows = db.prepare("SELECT name FROM task_tags WHERE task_id = ? ORDER BY id").all(taskId) as { name: string }[];
  return rows.map((r) => r.name);
}

/** 複数のタスクのタグを、タスク ID ごとにまとめて返す（付けた古い順）。タグの無いタスクは含まない。 */
export function listTagsByTask(taskIds: number[], db: Db = getDb()): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (taskIds.length === 0) return result;
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT task_id, name FROM task_tags WHERE task_id IN (${placeholders}) ORDER BY id`)
    .all(...taskIds) as { task_id: number; name: string }[];
  for (const r of rows) {
    const names = result.get(r.task_id) ?? [];
    names.push(r.name);
    result.set(r.task_id, names);
  }
  return result;
}

/** タグを付ける。すでに付いていれば "duplicate"。 */
export function addTag(taskId: number, name: string, db: Db = getDb()): "added" | "duplicate" {
  const { changes } = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, name) VALUES (?, ?)").run(taskId, name);
  return Number(changes) === 1 ? "added" : "duplicate";
}

/** タグを外す。付いていなければ "not_found"。 */
export function removeTag(taskId: number, name: string, db: Db = getDb()): "removed" | "not_found" {
  const { changes } = db.prepare("DELETE FROM task_tags WHERE task_id = ? AND name = ?").run(taskId, name);
  return Number(changes) === 1 ? "removed" : "not_found";
}
