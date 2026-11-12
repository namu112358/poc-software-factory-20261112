import { getDb, type Db } from "./db/index.ts";
import { listPendingExtensions, type PendingExtensionRow } from "./extensions.ts";
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

/** 自分の対応を待っている延長の申請。自分以外が出した承認待ちのすべて（自分の申請は承認できないので除く）。 */
export function listExtensionsAwaitingMe(userId: string, db: Db = getDb()): PendingExtensionRow[] {
  return listPendingExtensions(db).filter((e) => e.requester !== userId);
}
