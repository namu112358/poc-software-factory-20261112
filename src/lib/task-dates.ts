import { TASK_DUE_FILTERS, type Task, type TaskDueFilter } from "./task-types.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 日本時間の「今日」を YYYY-MM-DD で返す。 */
export function todayInJapan(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
}

/** YYYY-MM-DD の日付に日数を足した YYYY-MM-DD。 */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `due` クエリの型ガード。不正な値は指定なし（undefined）。 */
export function parseDueFilter(value: unknown): TaskDueFilter | undefined {
  return typeof value === "string" && (TASK_DUE_FILTERS as readonly string[]).includes(value) ? (value as TaskDueFilter) : undefined;
}

/** 期限までの残り日数の表示文言。完了したタスクは undefined（表示しない）。 */
export function formatDaysLeft(
  task: Pick<Task, "status" | "dueDate">,
  today: string = todayInJapan(),
): string | undefined {
  if (task.status === "done") return undefined;
  const diff = Math.round((Date.parse(task.dueDate) - Date.parse(today)) / MS_PER_DAY);
  if (Number.isNaN(diff)) return undefined;
  if (diff > 0) return `あと ${diff} 日`;
  if (diff === 0) return "今日まで";
  return `${-diff} 日超過`;
}

/** 期限切れか。未完了で、期限日の翌日以降（期限当日は含めない）。日付は日本時間の YYYY-MM-DD。 */
export function isOverdue(task: Pick<Task, "status" | "dueDate">, today: string = todayInJapan()): boolean {
  return task.status !== "done" && task.dueDate < today;
}

/** 「期限が近い」とみなす日数。期限の 3 日前から当日まで（暦の日数。土日も数える）。 */
export const DUE_SOON_DAYS = 3;

/** 期限が近いか。未完了で、期限が今日から 3 日後までの間（今日を含む）。期限切れは含めない。日付は日本時間の YYYY-MM-DD。 */
export function isDueSoon(task: Pick<Task, "status" | "dueDate">, today: string = todayInJapan()): boolean {
  if (task.status === "done") return false;
  const diff = Math.round((Date.parse(task.dueDate) - Date.parse(today)) / MS_PER_DAY);
  if (Number.isNaN(diff)) return false;
  return diff >= 0 && diff <= DUE_SOON_DAYS;
}

/** 表示中のタスクのうち、期限切れ（`isOverdue`）の数。 */
export function countOverdue(tasks: Pick<Task, "status" | "dueDate">[], today: string = todayInJapan()): number {
  return tasks.filter((t) => isOverdue(t, today)).length;
}

/** 削除したタスクを元に戻せる日数。削除した時刻から、この日数ちょうどが過ぎると戻せなくなる。 */
export const RESTORE_DAYS = 30;
