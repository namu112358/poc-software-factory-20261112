import type { Db } from "./db/index.ts";
import { getDb } from "./db/index.ts";
import { parseTaskFilter } from "./export.ts";
import { listTasks, todayInJapan, type Task, type TaskFilter } from "./tasks.ts";

/** `archived` クエリの型ガード。`include` のときだけ true（アーカイブ済みも含める）。それ以外は指定なし。 */
export function parseIncludeArchived(value: unknown): boolean {
  return value === "include";
}

/**
 * タスク一覧の API のクエリ（status・assignee（複数）・tag（複数）・due・q・sort・archived）を、一覧画面・CSV と同じ検証で絞り込み条件にする。
 * 不正な値・今は無い担当者・使われていないタグは、その分だけ指定なし。
 */
export function parseTaskListQuery(query: URLSearchParams, db: Db = getDb()): TaskFilter {
  return { ...parseTaskFilter(query, db), includeArchived: parseIncludeArchived(query.get("archived")) };
}

/** タスク一覧のクエリを画面と同じ規則で検証し、絞り込んだ一覧を返す。期限の「今日」は `now` の日本時間の日付。 */
export function listTasksByQuery(query: URLSearchParams, db: Db = getDb(), now: Date = new Date()): Task[] {
  return listTasks({ ...parseTaskListQuery(query, db), today: todayInJapan(now) }, db);
}
