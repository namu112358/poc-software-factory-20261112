import { getDb, type Db } from "./db/index.ts";
import { getTask, type Task, type TaskPriority } from "./tasks.ts";

const NEXT_PRIORITY: Record<TaskPriority, TaskPriority | undefined> = {
  low: "medium",
  medium: "high",
  high: undefined,
};

export type RaiseResult =
  | { ok: true; task: Task }
  | { ok: false; reason: "not_found" | "already_highest" };

/** タスクの優先度を 1 段上げる（低 → 中 → 高）。すでに「高」なら何も変えない。 */
export function raisePriority(id: number, db: Db = getDb()): RaiseResult {
  const current = getTask(id, db);
  if (!current) return { ok: false, reason: "not_found" };
  const next = NEXT_PRIORITY[current.priority];
  if (!next) return { ok: false, reason: "already_highest" };
  // 同時に 2 回呼ばれても 2 段上がらないよう、読んだ優先度のときだけ更新する。
  const { changes } = db
    .prepare("UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ? AND priority = ?")
    .run(next, new Date().toISOString(), id, current.priority);
  if (Number(changes) === 0) return raisePriority(id, db);
  return { ok: true, task: getTask(id, db)! };
}
