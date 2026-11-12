import { getDb, type Db } from "./db/index.ts";
import { formatLeaveNote, listLeaveEndDates } from "./absence.ts";
import { todayInJapan } from "./task-dates.ts";

export type MemberOpenTask = { id: number; title: string; label: string };
/** leaveUntil は、今日（日本時間）が休みの期間に入っていれば、その終了日（YYYY-MM-DD）。休みでなければ null。 */
export type MemberRow = {
  id: string;
  name: string;
  openCount: number;
  overdueCount: number;
  tasks: MemberOpenTask[];
  leaveUntil: string | null;
};

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
  const leaveEndDates = listLeaveEndDates(db, today);
  return users.map((u) => {
    const own = tasks.filter((t) => t.assignee === u.id);
    const mine = own.map((t) => ({ id: t.id, title: t.title, label: truncateTitle(t.title) }));
    const overdueCount = own.filter((t) => t.dueDate !== null && t.dueDate < today).length;
    return { id: u.id, name: u.name, openCount: mine.length, overdueCount, tasks: mine, leaveUntil: leaveEndDates.get(u.id) ?? null };
  });
}

/** 期限切れの件数の多い順、同じなら未完了の件数の多い順、それも同じなら今の順（ID 順）に並べた新しい配列。 */
export function sortMembersByOverdue<T extends Pick<MemberRow, "id" | "openCount" | "overdueCount">>(members: T[]): T[] {
  return [...members].sort(
    (a, b) => b.overdueCount - a.overdueCount || b.openCount - a.openCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * 担当者の選択肢の文言。「佐藤（未完了 5・期限切れ 1）」。期限切れが 0 件なら「佐藤（未完了 5）」。
 * 休み中なら末尾に「（休み: 11/20 まで）」を付ける（知らせるだけで、選ぶことは止めない）。
 */
export function formatAssigneeOption(
  m: Pick<MemberRow, "name" | "openCount" | "overdueCount"> & { leaveUntil?: string | null },
): string {
  const overdue = m.overdueCount > 0 ? `・期限切れ ${m.overdueCount}` : "";
  const leave = m.leaveUntil ? formatLeaveNote(m.leaveUntil) : "";
  return `${m.name}（未完了 ${m.openCount}${overdue}）${leave}`;
}

export type AssigneeOption = { id: string; name: string; label: string };

/** 担当者の選択肢（id・name・件数つきの label）。件数はメンバーの一覧と同じ数え方。並びはユーザー ID 順。 */
export function listAssigneeOptions(db: Db = getDb(), today: string = todayInJapan()): AssigneeOption[] {
  return listMemberWorkload(db, today).map((m) => ({ id: m.id, name: m.name, label: formatAssigneeOption(m) }));
}
