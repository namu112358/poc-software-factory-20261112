import { getDb, type Db } from "./db/index.ts";
import { todayInJapan } from "./task-dates.ts";

export type MemberOpenTask = { id: number; title: string; label: string };
export type MemberRow = { id: string; name: string; openCount: number; overdueCount: number; tasks: MemberOpenTask[] };

const TITLE_MAX = 10;

/** 題名が 10 文字を超えるときは、先頭の 10 文字の後に「…」を付ける（絵文字などは 1 文字として数える）。 */
export function truncateTitle(title: string): string {
  const chars = Array.from(title);
  return chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX).join("")}…` : title;
}

/** メンバーごとの、担当している未完了（完了以外）で、アーカイブしていないタスク。メンバーはユーザー ID 順、タスクは期限の早い順。 */
export function listMemberWorkload(db: Db = getDb(), today: string = todayInJapan()): MemberRow[] {
  const users = db.prepare("SELECT id, name FROM users ORDER BY id").all() as { id: string; name: string }[];
  const tasks = db
    .prepare("SELECT id, title, assignee, due_date AS dueDate FROM tasks WHERE status <> 'done' AND archived = 0 AND deleted_at IS NULL AND assignee IS NOT NULL ORDER BY due_date IS NULL, due_date, id")
    .all() as { id: number; title: string; assignee: string; dueDate: string | null }[];
  return users.map((u) => {
    const own = tasks.filter((t) => t.assignee === u.id);
    const mine = own.map((t) => ({ id: t.id, title: t.title, label: truncateTitle(t.title) }));
    const overdueCount = own.filter((t) => t.dueDate !== null && t.dueDate < today).length;
    return { id: u.id, name: u.name, openCount: mine.length, overdueCount, tasks: mine };
  });
}

/** 担当者の選択肢の文言。「佐藤（未完了 5・期限切れ 1）」。期限切れが 0 件なら「佐藤（未完了 5）」。 */
export function formatAssigneeOption(m: Pick<MemberRow, "name" | "openCount" | "overdueCount">): string {
  const overdue = m.overdueCount > 0 ? `・期限切れ ${m.overdueCount}` : "";
  return `${m.name}（未完了 ${m.openCount}${overdue}）`;
}

export type AssigneeOption = { id: string; name: string; label: string };

/** 担当者の選択肢（id・name・件数つきの label）。件数はメンバーの一覧と同じ数え方。並びはユーザー ID 順。 */
export function listAssigneeOptions(db: Db = getDb(), today: string = todayInJapan()): AssigneeOption[] {
  return listMemberWorkload(db, today).map((m) => ({ id: m.id, name: m.name, label: formatAssigneeOption(m) }));
}
