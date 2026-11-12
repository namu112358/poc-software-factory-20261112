import type { Db } from "./db/index.ts";
import { getDb } from "./db/index.ts";
import { parseDueFilter } from "./task-dates.ts";
import { parseIncludeArchived } from "./task-query.ts";
import { isTaskStatus, parseAssignees, parseKeyword, parseSort, parseTagFilters } from "./tasks.ts";

/** タスク一覧の条件を表すクエリのキー。URL にこのうち 1 つでもあれば「URL に条件が付いている」とみなす。 */
export const TASK_VIEW_KEYS = ["status", "assignee", "tag", "q", "due", "sort", "archived"] as const;

/** 覚えた条件も消してタスク一覧を開くためのリンク先。 */
export const RESET_TASK_VIEW_HREF = "/tasks?reset=1";

export type TaskViewQuery = Partial<Record<Exclude<(typeof TASK_VIEW_KEYS)[number], "tag" | "assignee">, string>> & { tag?: string[]; assignee?: string[] };

/** URL のクエリに、タスク一覧の条件のキーが 1 つでもあるか（空の値でもあるとみなす。「すべて」を選んで絞り込んだ場合を含める）。 */
export function hasTaskViewParams(params: Record<string, unknown>): boolean {
  return TASK_VIEW_KEYS.some((k) => params[k] !== undefined);
}

/** 条件を検証して、有効な項目だけの文字列の組にする。不正な値・今は無いタグや担当者・既定値の項目は入れない（指定なし）。 */
export function sanitizeTaskViewQuery(raw: Record<string, unknown>, db: Db = getDb()): TaskViewQuery {
  const out: TaskViewQuery = {};
  const status = raw.status;
  if (isTaskStatus(status)) out.status = status;
  const assignees = parseAssignees(raw.assignee, db);
  if (assignees.length > 0) out.assignee = assignees;
  const tags = parseTagFilters(raw.tag, db);
  if (tags.length > 0) out.tag = tags;
  const q = parseKeyword(raw.q);
  if (q !== undefined) out.q = q;
  const due = parseDueFilter(raw.due);
  if (due !== undefined) out.due = due;
  if (typeof raw.sort === "string" && parseSort(raw.sort) === raw.sort) out.sort = raw.sort;
  if (parseIncludeArchived(raw.archived)) out.archived = "include";
  return out;
}

/** この利用者の覚えた条件を保存する。条件が空なら行を消す。 */
export function saveTaskViewPrefs(userId: string, raw: Record<string, unknown>, db: Db = getDb()): void {
  const query = sanitizeTaskViewQuery(raw, db);
  if (Object.keys(query).length === 0) {
    clearTaskViewPrefs(userId, db);
    return;
  }
  db.prepare("INSERT INTO task_view_prefs (user_id, query) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET query = excluded.query").run(
    userId,
    JSON.stringify(query),
  );
}

/** この利用者の覚えた条件を消す。 */
export function clearTaskViewPrefs(userId: string, db: Db = getDb()): void {
  db.prepare("DELETE FROM task_view_prefs WHERE user_id = ?").run(userId);
}

/** この利用者の覚えた条件を返す。読むときにも検証し直し、壊れた値や今は無いタグ・担当者の項目は外す。 */
export function loadTaskViewPrefs(userId: string, db: Db = getDb()): TaskViewQuery {
  const row = db.prepare("SELECT query FROM task_view_prefs WHERE user_id = ?").get(userId) as { query: string } | undefined;
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.query);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return sanitizeTaskViewQuery(parsed as Record<string, unknown>, db);
  } catch {
    return {};
  }
}

/**
 * タスク一覧で使う条件を決める。URL に条件が付いていればそれを使い（覚えない場合は reset のとき）、
 * 付いていなければ覚えた条件を使う。`reset` のときは覚えた条件を消して条件なしにする。
 */
export function resolveTaskViewQuery<P extends Record<string, unknown>>(userId: string, params: P, reset: boolean, db: Db = getDb()): Record<string, unknown> {
  if (reset) {
    clearTaskViewPrefs(userId, db);
    return {};
  }
  if (hasTaskViewParams(params)) {
    saveTaskViewPrefs(userId, params, db);
    return params;
  }
  return loadTaskViewPrefs(userId, db);
}
