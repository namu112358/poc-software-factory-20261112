import { getDb, transaction, type Db } from "./db/index.ts";
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
  // 絵文字なども 1 文字と数えるため、UTF-16 の長さではなくコードポイントの数で数える。
  const length = [...trimmed].length;
  if (length < 1 || length > TAG_MAX_LENGTH) {
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

export type TagCount = { name: string; count: number };

/** 使われているタグと、付いているタスク（アーカイブしたものを除く）の件数を返す。件数の多い順、同じ件数なら名前の昇順。 */
export function listTagCounts(db: Db = getDb()): TagCount[] {
  const rows = db
    .prepare("SELECT g.name AS name, COUNT(*) AS count FROM task_tags g JOIN tasks t ON t.id = g.task_id WHERE t.archived = 0 GROUP BY g.name ORDER BY count DESC, g.name ASC")
    .all() as { name: string; count: number }[];
  return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
}

/** タグの入力候補を返す。そのタスクにすでに付いているタグを除き、使われている件数の多い順（同数なら名前の昇順）。 */
export function listTagSuggestions(taskId: number, db: Db = getDb()): string[] {
  const attached = new Set(listTags(taskId, db));
  return listTagCounts(db)
    .map((t) => t.name)
    .filter((name) => !attached.has(name));
}

export type TagRenameInput = { from: string; to: string };

/**
 * タグの付け替え（POST /api/tags/rename）の本文を検証する。`from`・`to` はどちらも、タグを付けるときと同じ規則
 * （`validateTagInput`）で確かめ、前後の空白を除いた値を使う。除いた後で `from` と `to` が同じなら誤り。
 */
export function validateTagRenameInput(body: unknown): ValidationResult<TagRenameInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const errors: string[] = [];
  const names: Partial<TagRenameInput> = {};
  for (const key of ["from", "to"] as const) {
    const r = validateTagInput({ name: (body as Record<string, unknown>)[key] });
    if (r.ok) names[key] = r.value.name;
    else errors.push(...r.errors.map((e) => `${key}: ${e}`));
  }
  if (errors.length > 0) return { ok: false, errors };
  if (names.from === names.to) return { ok: false, errors: ["from と to に同じタグの名前は指定できません"] };
  return { ok: true, value: { from: names.from!, to: names.to! } };
}

export type TagRenameResult = { ok: true; count: number } | { ok: false; reason: "not_found" };

/**
 * タグ `from` を、付いているすべてのタスク（アーカイブしたものを含む）で `to` に付け替え、付け替えたタスクの件数を返す。
 * すでに `to` も付いているタスクでは `from` を外すだけにする。付け替えたタグは、そのタスクの中で元の位置に残る。
 * 全部か無しか: 1 つのトランザクションで行い、途中で失敗したらすべて戻す。`from` の付いたタスクが無ければ何も変えない。
 * タグを付ける・外すときと同じく、タスクの最終更新日時は変えない。
 */
export function renameTag(from: string, to: string, db: Db = getDb()): TagRenameResult {
  return transaction(db, (): TagRenameResult => {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM task_tags WHERE name = ?").get(from) as { n: number };
    const count = Number(n);
    if (count === 0) return { ok: false, reason: "not_found" };
    db.prepare(
      "DELETE FROM task_tags WHERE name = :from AND task_id IN (SELECT task_id FROM task_tags WHERE name = :to)",
    ).run({ from, to });
    db.prepare("UPDATE task_tags SET name = :to WHERE name = :from").run({ from, to });
    return { ok: true, count };
  });
}
