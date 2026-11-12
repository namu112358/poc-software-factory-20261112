import { getDb, type Db } from "./db/index.ts";

export type MemberOpenTask = { id: number; title: string; label: string };
export type MemberRow = { id: string; name: string; openCount: number; tasks: MemberOpenTask[] };

const TITLE_MAX = 10;

/** 題名が 10 文字を超えるときは、先頭の 10 文字の後に「…」を付ける（絵文字などは 1 文字として数える）。 */
export function truncateTitle(title: string): string {
  const chars = Array.from(title);
  return chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX).join("")}…` : title;
}

/** メンバーごとの、担当している未完了（完了以外）のタスク。メンバーはユーザー ID 順、タスクは期限の早い順。 */
export function listMemberWorkload(db: Db = getDb()): MemberRow[] {
  const users = db.prepare("SELECT id, name FROM users ORDER BY id").all() as { id: string; name: string }[];
  const tasks = db
    .prepare("SELECT id, title, assignee FROM tasks WHERE status <> 'done' AND assignee IS NOT NULL ORDER BY due_date IS NULL, due_date, id")
    .all() as { id: number; title: string; assignee: string }[];
  return users.map((u) => {
    const mine = tasks.filter((t) => t.assignee === u.id).map((t) => ({ id: t.id, title: t.title, label: truncateTitle(t.title) }));
    return { id: u.id, name: u.name, openCount: mine.length, tasks: mine };
  });
}
