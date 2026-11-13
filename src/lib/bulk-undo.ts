// まとめて変えた担当者・ステータスを元に戻す処理（POST /api/tasks/bulk-update/undo）。
// 記録はまとめて変える処理（bulk-update.ts の updateTasks）が書く。
import { BULK_UNDO_MINUTES } from "./bulk-select.ts";
import { getDb, transaction, type Db } from "./db/index.ts";
import { nextUpdatedAt, type ValidationResult } from "./tasks.ts";

export { BULK_UNDO_MINUTES };

/** 元に戻せる期間（ミリ秒）。変えてからちょうどこの時間までは戻せる。 */
export const BULK_UNDO_WINDOW_MS = BULK_UNDO_MINUTES * 60 * 1000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 元に戻す API の本文を検証する。`id` はまとめての変更 1 回分の ID（正の整数）。 */
export function validateBulkUndoInput(body: unknown): ValidationResult<{ id: number }> {
  if (!isPlainObject(body)) return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  const id = body.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, errors: ["id には元に戻す変更の ID（正の整数）を指定してください"] };
  }
  return { ok: true, value: { id } };
}

export type BulkUndoRecord = { changedBy: string | null; changedAt: string; undoneAt: string | null };

export type BulkUndoRefusal = "not_found" | "forbidden" | "expired" | "already_undone";

/**
 * 元に戻してよいかの判定。記録が無ければ not_found、変えた本人でなければ forbidden（変えた人が分からない記録はだれも戻せない）、
 * もう戻していれば already_undone、変えてから BULK_UNDO_MINUTES 分を過ぎていれば expired。戻してよければ null。
 */
export function bulkUndoRefusal(record: BulkUndoRecord | undefined, userId: string, now: Date): BulkUndoRefusal | null {
  if (record === undefined) return "not_found";
  if (record.changedBy === null || record.changedBy !== userId) return "forbidden";
  if (record.undoneAt !== null) return "already_undone";
  const changedAt = Date.parse(record.changedAt);
  if (Number.isNaN(changedAt) || now.getTime() - changedAt > BULK_UNDO_WINDOW_MS) return "expired";
  return null;
}

export type BulkUndoResult =
  | { ok: true; restoredIds: number[]; skippedIds: number[] }
  | { ok: false; reason: BulkUndoRefusal };

type ItemRow = {
  taskId: number;
  fromStatus: string;
  fromAssignee: string;
  fromCompletedAt: string | null;
  updatedAt: string;
  currentAssignee: string | null;
  currentUpdatedAt: string | null;
  fromAssigneeSuspended: number;
};

/**
 * まとめての変更 1 回分を元に戻す。変えたタスクを、変える前の担当者・ステータス・完了日時に戻す。
 * 変えた後にほかの変更があったタスク（更新日時が変えた直後の値と違う）と、削除したタスクは戻さず `skippedIds` に入れる。
 * 戻すと担当者がログインを停止した利用者に替わるタスクも、戻さず `skippedIds` に入れる（停止した人に担当を戻さない。#522）。
 * 戻したタスクの更新日時は前回より必ず後にし（`nextUpdatedAt`）、担当者が変わるときは担当者の変更の履歴を `userId` の名前で足す。
 * 全部か無しか: 1 つのトランザクションで行い、途中で失敗したらどのタスクも戻さず、戻した印も付けない。戻せるのは 1 回だけ。
 */
export function undoBulkUpdate(id: number, userId: string, db: Db = getDb(), now: Date = new Date()): BulkUndoResult {
  return transaction(db, () => {
    const record = db
      .prepare("SELECT changed_by AS changedBy, changed_at AS changedAt, undone_at AS undoneAt FROM bulk_updates WHERE id = ?")
      .get(id) as BulkUndoRecord | undefined;
    const refusal = bulkUndoRefusal(record, userId, now);
    if (refusal !== null) return { ok: false, reason: refusal };

    const items = db
      .prepare(
        `SELECT i.task_id AS taskId, i.from_status AS fromStatus, i.from_assignee AS fromAssignee,
                i.from_completed_at AS fromCompletedAt, i.updated_at AS updatedAt,
                t.assignee AS currentAssignee, t.updated_at AS currentUpdatedAt,
                (fu.suspended_at IS NOT NULL) AS fromAssigneeSuspended
           FROM bulk_update_items i
           LEFT JOIN tasks t ON t.id = i.task_id AND t.deleted_at IS NULL
           LEFT JOIN users fu ON fu.id = i.from_assignee
          WHERE i.bulk_update_id = ?
          ORDER BY i.task_id`,
      )
      .all(id) as ItemRow[];
    const restore = db.prepare(
      "UPDATE tasks SET status = ?, assignee = ?, completed_at = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL",
    );
    const recordAssigneeChange = db.prepare(
      "INSERT INTO task_assignee_changes (task_id, from_assignee, to_assignee, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)",
    );
    const restoredIds: number[] = [];
    const skippedIds: number[] = [];
    for (const item of items) {
      const toSuspended = item.fromAssigneeSuspended === 1 && item.currentAssignee !== item.fromAssignee;
      if (item.currentUpdatedAt === null || item.currentUpdatedAt !== item.updatedAt || toSuspended) {
        skippedIds.push(item.taskId);
        continue;
      }
      const updatedAt = nextUpdatedAt(item.currentUpdatedAt, now);
      const { changes } = restore.run(item.fromStatus, item.fromAssignee, item.fromCompletedAt, updatedAt, item.taskId, item.updatedAt);
      if (Number(changes) === 0) {
        skippedIds.push(item.taskId);
        continue;
      }
      if (item.currentAssignee !== item.fromAssignee) {
        recordAssigneeChange.run(item.taskId, item.currentAssignee, item.fromAssignee, userId, updatedAt);
      }
      restoredIds.push(item.taskId);
    }
    db.prepare("UPDATE bulk_updates SET undone_at = ? WHERE id = ?").run(now.toISOString(), id);
    return { ok: true, restoredIds, skippedIds };
  });
}
