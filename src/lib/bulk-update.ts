// タスクのステータス・担当者をまとめて変える処理（POST /api/tasks/bulk-update）。
import { getDb, transaction, type Db } from "./db/index.ts";
import { getTask, isTaskStatus, type Task, type TaskStatus, type ValidationResult } from "./tasks.ts";

/** まとめて変えられるタスクの最大件数（一括完了と同じ）。 */
export const BULK_UPDATE_MAX = 100;

/** まとめて変えられる項目。 */
export const BULK_UPDATE_FIELDS = ["status", "assignee"] as const;

export type BulkUpdateChanges = { status?: TaskStatus; assignee?: string };

export type BulkUpdateInput = { ids: number[]; changes: BulkUpdateChanges };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * まとめて変える API の本文を検証する。`ids` は重複のない 1〜100 件の正の整数の配列。
 * `changes` は `status` と `assignee` のうち 1 つ以上だけを持つオブジェクト。担当者が存在するかは DB で確認する。
 */
export function validateBulkUpdateInput(body: unknown, db: Db = getDb()): ValidationResult<BulkUpdateInput> {
  if (!isPlainObject(body)) return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  const errors: string[] = [];

  const ids = body.ids;
  if (ids === undefined) errors.push("ids を指定してください");
  else if (!Array.isArray(ids)) errors.push("ids はタスクの ID の配列で指定してください");
  else if (ids.length === 0) errors.push("ids に 1 件以上の ID を指定してください");
  else if (!ids.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
    errors.push("ids には正の整数だけを指定してください");
  } else if (new Set(ids).size !== ids.length) errors.push("ids に同じ ID が重複しています");
  else if (ids.length > BULK_UPDATE_MAX) errors.push(`ids は ${BULK_UPDATE_MAX} 件以内で指定してください`);

  const changes = body.changes;
  const value: BulkUpdateChanges = {};
  if (changes === undefined) errors.push("changes を指定してください");
  else if (!isPlainObject(changes)) errors.push("changes はオブジェクトで指定してください");
  else {
    const keys = Object.keys(changes);
    const unknown = keys.filter((k) => !(BULK_UPDATE_FIELDS as readonly string[]).includes(k));
    if (unknown.length > 0) {
      errors.push(`changes に指定できるのは status と assignee だけです（指定できない項目: ${unknown.join("、")}）`);
    } else if (keys.length === 0) {
      errors.push("changes に status か assignee を指定してください");
    }
    if ("status" in changes) {
      if (!isTaskStatus(changes.status)) errors.push("ステータスが正しくありません");
      else value.status = changes.status;
    }
    if ("assignee" in changes) {
      const exists =
        typeof changes.assignee === "string" &&
        db.prepare("SELECT 1 FROM users WHERE id = ?").get(changes.assignee) !== undefined;
      if (!exists) errors.push("担当者が存在しません");
      else value.assignee = changes.assignee as string;
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { ids: ids as number[], changes: value } };
}

export type BulkUpdateResult = { ok: true; tasks: Task[] } | { ok: false; missingIds: number[] };

/**
 * 指定したタスクに同じ変更をまとめて入れる。全部か無しか: 存在しない ID が 1 つでもあれば何も変えず、
 * 途中で失敗したらすべて戻す。値が変わらないタスクは、最終更新日時も変えない。結果は ids の順に並べる。
 */
export function updateTasks(ids: readonly number[], changes: BulkUpdateChanges, db: Db = getDb()): BulkUpdateResult {
  return transaction(db, () => {
    const found = ids.map((id) => getTask(id, db));
    const missingIds = ids.filter((_, i) => found[i] === undefined);
    if (missingIds.length > 0) return { ok: false, missingIds };
    const now = new Date().toISOString();
    const update = db.prepare("UPDATE tasks SET status = ?, assignee = ?, updated_at = ? WHERE id = ?");
    for (const task of found as Task[]) {
      const status = changes.status ?? task.status;
      const assignee = changes.assignee ?? task.assignee;
      if (status === task.status && assignee === task.assignee) continue;
      update.run(status, assignee, now, task.id);
    }
    return { ok: true, tasks: ids.map((id) => getTask(id, db)!) };
  });
}
