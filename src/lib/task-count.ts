// ステータスごとのタスク数（GET /api/task-count が返す）。アーカイブしたタスクは数えない。
import { getDb, type Db } from "./db/index.ts";
import { TASK_STATUSES, isTaskStatus, type TaskStatus } from "./task-types.ts";

export type TaskCount = Record<TaskStatus, number>;

/** アーカイブしていないタスクを、ステータスごとに数える。0 件のステータスも 0 で返す。 */
export function countTasksByStatus(db: Db = getDb()): TaskCount {
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as TaskCount;
  const rows = db
    .prepare("SELECT status, COUNT(*) AS n FROM tasks WHERE archived = 0 AND deleted_at IS NULL GROUP BY status")
    .all() as { status: string; n: number }[];
  for (const row of rows) {
    if (isTaskStatus(row.status)) counts[row.status] = Number(row.n);
  }
  return counts;
}
