import { getDb, type Db } from "./db/index.ts";
import { getTask, type Task } from "./tasks.ts";

/** 期限を 7 日後ろにずらす。YYYY-MM-DD の日付だけを扱い、時差の影響を受けない。 */
export function addSevenDays(dueDate: string): string {
  const [y, m, d] = dueDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 7));
  return date.toISOString().slice(0, 10);
}

export type PostponeResult =
  | { ok: true; task: Task }
  | { ok: false; reason: "not_found" | "done" };

/** タスクの期限を 7 日後ろにずらす。完了したタスクは変えない。 */
export function postponeTask(id: number, db: Db = getDb(), now: Date = new Date()): PostponeResult {
  const task = getTask(id, db);
  if (!task) return { ok: false, reason: "not_found" };
  if (task.status === "done") return { ok: false, reason: "done" };
  db.prepare("UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ? AND status <> 'done'").run(
    addSevenDays(task.dueDate),
    now.toISOString(),
    id,
  );
  return { ok: true, task: getTask(id, db)! };
}
