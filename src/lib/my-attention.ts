import { getDb, type Db } from "./db/index.ts";
import { listPendingExtensions, type PendingExtensionRow } from "./extensions.ts";
import { isCoordinator } from "./users.ts";
import { addDays, DUE_SOON_DAYS, todayInJapan } from "./task-dates.ts";

export type MyTaskRow = {
  id: number;
  title: string;
  dueDate: string; // YYYY-MM-DD
  kind: "overdue" | "due-soon";
};

export const NOTHING_TO_DO_TEXT = "対応が必要なものはありません";

/**
 * 自分が担当で、未完了・アーカイブしていないタスクのうち、期限切れ（今日より前）と
 * 期限間近（今日から DUE_SOON_DAYS 日後まで）のもの。期限の近い順（同じなら ID 順）。日付は日本時間。
 */
export function listMyDueTasks(userId: string, db: Db = getDb(), today: string = todayInJapan()): MyTaskRow[] {
  const limit = addDays(today, DUE_SOON_DAYS);
  const rows = db
    .prepare(
      `SELECT id, title, due_date AS dueDate FROM tasks
       WHERE assignee = ? AND status <> 'done' AND archived = 0 AND deleted_at IS NULL AND due_date <= ?
       ORDER BY due_date, id`,
    )
    .all(userId, limit) as { id: number; title: string; dueDate: string }[];
  return rows.map((r) => ({ ...r, kind: r.dueDate < today ? "overdue" : "due-soon" }));
}

/**
 * 自分の対応を待っている延長の申請。取りまとめる人なら、自分以外が出した承認待ちのすべて（自分の申請は承認できないので除く）。
 * 取りまとめる人でなければ、承認できないので何も返さない。
 */
export function listExtensionsAwaitingMe(userId: string, db: Db = getDb()): PendingExtensionRow[] {
  if (!isCoordinator(userId, db)) return [];
  return listPendingExtensions(db).filter((e) => e.requester !== userId);
}

export type SuspendedBacklogRow = { id: string; name: string; count: number };

/**
 * ログインを停止した人が担当のまま残っている、未完了・アーカイブしていない・削除していないタスクの件数（停止した人ごと、ID 順）。
 * 0 件の人は含めない。取りまとめる人でなければ、担当を替えられないので何も返さない（#538）。
 */
export function listSuspendedBacklog(userId: string, db: Db = getDb()): SuspendedBacklogRow[] {
  if (!isCoordinator(userId, db)) return [];
  const rows = db
    .prepare(
      `SELECT u.id AS id, u.name AS name, COUNT(*) AS count
       FROM users u JOIN tasks t ON t.assignee = u.id
       WHERE u.suspended_at IS NOT NULL AND t.status <> 'done' AND t.archived = 0 AND t.deleted_at IS NULL
       GROUP BY u.id, u.name ORDER BY u.id`,
    )
    .all() as SuspendedBacklogRow[];
  return rows.map(({ id, name, count }) => ({ id, name, count }));
}

/** 「対応が必要なもの」の各項目で、欄に並べる最大の件数。超えた分は「ほか N 件」にする。 */
export const MY_ATTENTION_LIMIT = 5;

/** 先頭から `limit` 件までを出し、残りの件数を返す。`limit` 以下なら残りは 0。 */
export function limitItems<T>(items: T[], limit: number = MY_ATTENTION_LIMIT): { shown: T[]; hidden: number } {
  return { shown: items.slice(0, limit), hidden: Math.max(0, items.length - limit) };
}

/** 期限切れと期限間近の件数（欄の見出しの近くに出す内訳）。 */
export function countMyDueTasks(tasks: MyTaskRow[]): { overdue: number; dueSoon: number } {
  const overdue = tasks.filter((t) => t.kind === "overdue").length;
  return { overdue, dueSoon: tasks.length - overdue };
}

/** 「ほか N 件」のリンク先: 自分の担当で、欄と同じ範囲（期限切れ＋今日から DUE_SOON_DAYS 日後まで）の期限で絞り込んだタスク一覧。 */
export function myDueTasksHref(userId: string): string {
  return `/tasks?assignee=${encodeURIComponent(userId)}&due=soon`;
}
