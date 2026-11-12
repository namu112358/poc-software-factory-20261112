import { getDb, type Db } from "./db/index.ts";
import { todayInJapan } from "./tasks.ts";

export type OverdueRow = {
  id: number;
  title: string;
  assigneeName: string; // 担当者がいないときは「—」
  dueDate: string; // YYYY-MM-DD
  daysOverdue: number;
  label: string; // 「3 日超過」
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 期限（YYYY-MM-DD）から今日（日本時間）までに過ぎた日数。 */
export function daysOverdue(dueDate: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(dueDate)) / MS_PER_DAY);
}

/** 期限が今日（日本時間）より前で、完了以外のタスク。何日過ぎたかの多い順（同じなら ID 順）。 */
export function listOverdueTasks(db: Db = getDb(), today: string = todayInJapan()): OverdueRow[] {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.title AS title, t.due_date AS dueDate, u.name AS assigneeName
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee
       WHERE t.status <> 'done' AND t.due_date < ?
       ORDER BY t.due_date, t.id`,
    )
    .all(today) as { id: number; title: string; dueDate: string; assigneeName: string | null }[];
  return rows.map((r) => {
    const days = daysOverdue(r.dueDate, today);
    return { id: r.id, title: r.title, assigneeName: r.assigneeName ?? "—", dueDate: r.dueDate, daysOverdue: days, label: `${days} 日超過` };
  });
}
