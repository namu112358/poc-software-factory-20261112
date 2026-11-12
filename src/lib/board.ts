import type { Db } from "./db/index.ts";
import { getDb } from "./db/index.ts";
import { STATUS_LABELS, TASK_STATUSES, listTasks, type TaskStatus } from "./tasks.ts";

export type BoardTask = { id: number; title: string; shortTitle: string };

export type BoardRow = {
  status: TaskStatus;
  label: string;
  count: number;
  tasks: BoardTask[];
};

const TITLE_LENGTH = 10;

/** 題名が 10 文字（見た目の文字）を超えるとき、先頭の 10 文字の後に「…」を付ける。 */
export function shortenTitle(title: string): string {
  const chars = Array.from(title);
  if (chars.length <= TITLE_LENGTH) return title;
  return chars.slice(0, TITLE_LENGTH).join("") + "…";
}

/** ステータスごとの行（未着手・進行中・完了の順）。各行のタスクは期限の早い順（同じ期限なら番号順）。 */
export function listBoard(db: Db = getDb()): BoardRow[] {
  return TASK_STATUSES.map((status) => {
    const tasks = listTasks({ status }, db)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id - b.id))
      .map((t) => ({ id: t.id, title: t.title, shortTitle: shortenTitle(t.title) }));
    return { status, label: STATUS_LABELS[status], count: tasks.length, tasks };
  });
}
