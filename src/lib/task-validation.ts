import { getDb, type Db } from "./db/index.ts";
import { listAssignees } from "./task-store.ts";
import { isTaskPriority, isTaskStatus, TASK_SORTS, UNASSIGNED, type TaskInput, type TaskSort, type ValidationResult, MEMO_MAX_LENGTH } from "./task-types.ts";

/** URL のクエリの並び順を検証する。不正な値は「作成順」として扱う。 */
export function parseSort(value: unknown): TaskSort {
  return typeof value === "string" && (TASK_SORTS as readonly string[]).includes(value) ? (value as TaskSort) : "created";
}

/** クエリの担当者 ID を検証する。`none`（担当者なし）かタスクに登場する担当者でなければ undefined（指定なし）。 */
export function parseAssignee(value: unknown, db: Db = getDb()): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value === UNASSIGNED) return UNASSIGNED;
  return listAssignees(db).some((a) => a.id === value) ? value : undefined;
}

/** URL のクエリのタグ名を検証する。前後の空白を取り除き、空なら undefined（指定なし）。 */
export function parseTagFilter(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** 絞り込みで選べるタグの最大数。6 つ目以降は無視する。 */
export const TAG_FILTER_MAX = 5;

/** タグ名の最大の長さ（タグの入力欄と同じ）。これより長い値は不正として無視する。 */
const TAG_FILTER_NAME_MAX = 40;

/**
 * URL のクエリのタグ名（`?tag=a&tag=b` のように複数）を検証する。文字列 1 つも配列も受け取る。
 * 前後の空白を取り除き、空・長すぎる値・重複を無視し、先頭の 5 つまでにしたうえで、今は使われていないタグを外す。
 */
export function parseTagFilters(value: unknown, db: Db = getDb()): string[] {
  const values = Array.isArray(value) ? value : [value];
  const names: string[] = [];
  for (const v of values) {
    const name = parseTagFilter(v);
    if (name === undefined || [...name].length > TAG_FILTER_NAME_MAX || names.includes(name)) continue;
    names.push(name);
    if (names.length === TAG_FILTER_MAX) break;
  }
  return names.filter((name) => db.prepare("SELECT 1 FROM task_tags WHERE name = ? LIMIT 1").get(name) !== undefined);
}

/** URL のクエリのキーワードを検証する。前後の空白を取り除き、空なら undefined（指定なし）。 */
export function parseKeyword(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** URL のパス・クエリの ID を検証する。正の整数でなければ undefined。 */
export function parseTaskId(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) return undefined;
  return Number(value);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * API に送られたタスクの内容を検証する。partial = true（更新）のときは、送られた項目だけを検証する。
 * 担当者が存在するかは DB で確認する。
 */
export function validateTaskInput(
  body: unknown,
  options: { partial?: boolean } = {},
  db: Db = getDb(),
): ValidationResult<Partial<TaskInput>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const b = body as Record<string, unknown>;
  const errors: string[] = [];
  const value: Partial<TaskInput> = {};
  const need = (key: string) => !options.partial || key in b;

  if (need("title")) {
    if (typeof b.title !== "string" || b.title.trim() === "" || b.title.length > 200) {
      errors.push("タイトルは 1〜200 文字で入力してください");
    } else value.title = b.title.trim();
  }
  if (need("status")) {
    if (!isTaskStatus(b.status)) errors.push("ステータスが正しくありません");
    else value.status = b.status;
  }
  if (need("assignee")) {
    const exists =
      typeof b.assignee === "string" && db.prepare("SELECT 1 FROM users WHERE id = ?").get(b.assignee) !== undefined;
    if (!exists) errors.push("担当者が存在しません");
    else value.assignee = b.assignee as string;
  }
  if (need("dueDate")) {
    if (typeof b.dueDate !== "string" || !DATE_RE.test(b.dueDate) || Number.isNaN(Date.parse(b.dueDate))) {
      errors.push("期限は YYYY-MM-DD 形式で入力してください");
    } else value.dueDate = b.dueDate;
  }
  if ("priority" in b) {
    if (!isTaskPriority(b.priority)) errors.push("優先度は high・medium・low のいずれかにしてください");
    else value.priority = b.priority;
  }
  if ("estimateMinutes" in b) {
    const m = b.estimateMinutes;
    if (m === null) value.estimateMinutes = null;
    else if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 10000) {
      errors.push("見積もり時間は 1〜10000 の整数（分）で入力してください");
    } else value.estimateMinutes = m;
  }
  if ("memo" in b) {
    if (typeof b.memo !== "string" || b.memo.length > MEMO_MAX_LENGTH) {
      errors.push(`メモは ${MEMO_MAX_LENGTH} 文字以内の文字列で入力してください`);
    } else value.memo = b.memo;
  }
  if ("archived" in b) {
    if (typeof b.archived !== "boolean") errors.push("archived は true か false で指定してください");
    else value.archived = b.archived;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** タイムゾーン付きの ISO 8601 の日時として正しいか（2 月 30 日・24 時のような、Date.parse が繰り上げる値も誤りにする）。 */
function isDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_TIME_RE.exec(value);
  if (!m) return false;
  const [y, mo, d, hh, mi, ss, tzh, tzm] = m.slice(1).map((x) => Number(x ?? 0));
  const day = new Date(Date.UTC(y, mo - 1, d));
  return (
    day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d &&
    hh < 24 && mi < 60 && ss < 60 && tzh < 24 && tzm < 60 && !Number.isNaN(Date.parse(value))
  );
}

/**
 * 更新の本文の `expectedUpdatedAt`（編集を始めたときのタスクの更新日時）を検証する。
 * 無ければ undefined（確認せずに上書きする）。あれば、タイムゾーン付きの ISO 8601 の日時だけを受け付け、
 * サーバーの更新日時と比べられるように UTC の `toISOString()` の形にそろえて返す。
 */
export function parseExpectedUpdatedAt(body: unknown): ValidationResult<string | undefined> {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("expectedUpdatedAt" in body)) {
    return { ok: true, value: undefined };
  }
  const v = (body as Record<string, unknown>).expectedUpdatedAt;
  if (!isDateTime(v)) {
    return { ok: false, errors: ["expectedUpdatedAt は日時（ISO 8601、例: 2026-11-12T09:00:00.000Z）で指定してください"] };
  }
  return { ok: true, value: new Date(Date.parse(v)).toISOString() };
}

/** まとめて完了にできるタスクの最大件数。 */
export const BULK_COMPLETE_MAX = 100;

/**
 * まとめて完了にする API の本文を検証する。`ids` は 1〜100 件の正の整数の配列。
 * 重複した ID は 1 件にまとめ、送られた順（初出順）で返す。
 */
export function validateBulkCompleteInput(body: unknown): ValidationResult<number[]> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const ids = (body as Record<string, unknown>).ids;
  if (ids === undefined) return { ok: false, errors: ["ids を指定してください"] };
  if (!Array.isArray(ids)) return { ok: false, errors: ["ids はタスクの ID の配列で指定してください"] };
  if (ids.length === 0) return { ok: false, errors: ["ids に 1 件以上の ID を指定してください"] };
  if (!ids.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
    return { ok: false, errors: ["ids には正の整数だけを指定してください"] };
  }
  const unique = [...new Set(ids as number[])];
  if (unique.length > BULK_COMPLETE_MAX) {
    return { ok: false, errors: [`ids は ${BULK_COMPLETE_MAX} 件以内で指定してください`] };
  }
  return { ok: true, value: unique };
}
