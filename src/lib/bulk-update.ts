// タスクのステータス・担当者をまとめて変える処理（POST /api/tasks/bulk-update）。
import { BULK_SELECT_MAX } from "./bulk-select.ts";
import { isAssignableUser } from "./users.ts";
import { SUSPENDED_ASSIGNEE_ERROR } from "./task-validation.ts";
import { getDb, transaction, type Db } from "./db/index.ts";
import { COMPLETED_AT_SQL, getTask, isTaskStatus, nextUpdatedAt, type Task, type TaskStatus, type ValidationResult } from "./tasks.ts";

/** まとめて変えられるタスクの最大件数（一括完了と同じ）。 */
export const BULK_UPDATE_MAX = BULK_SELECT_MAX;

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
 * ログインを停止した利用者は担当者にできない（#522）。
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
      else if (!isAssignableUser(changes.assignee, db)) errors.push(SUSPENDED_ASSIGNEE_ERROR);
      else value.assignee = changes.assignee as string;
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { ids: ids as number[], changes: value } };
}

/**
 * 元に戻すための記録。`id` はまとめての変更 1 回分の ID、`count` は値が実際に変わったタスクの数。
 * 1 件も変わらなかったときは記録を作らず null にする（元に戻すものが無い）。
 */
export type BulkUndoTicket = { id: number; count: number } | null;

export type BulkUpdateResult = { ok: true; tasks: Task[]; undo: BulkUndoTicket } | { ok: false; missingIds: number[] };

/**
 * 指定したタスクに同じ変更をまとめて入れる。全部か無しか: 存在しない ID が 1 つでもあれば何も変えず、
 * 途中で失敗したらすべて戻す。値が変わらないタスクは、最終更新日時も変えない。完了日時はステータスの変化に合わせて決まる
 * （完了にしたら記録し、すでに完了なら変えず、完了以外にしたら null）。結果は ids の順に並べる。
 * 担当者が変わったタスクには、担当者の変更の履歴を同じトランザクションの中で 1 件ずつ足す（`changedBy` は変更した利用者の ID）。
 * 変えたタスクの更新日時は、1 件ずつの更新と同じく、そのタスクの前回の更新日時より必ず後にする（`nextUpdatedAt`。`now` は今の時刻）。
 * 履歴の日時・完了日時も同じ値にする。同じミリ秒に続けて更新しても、履歴が替えた順に並び、確認つきの更新が衝突になる。
 * 値が変わったタスクの変える前の値と、変えた直後の更新日時を、同じトランザクションの中で記録する（元に戻すため。`bulk-undo.ts`）。
 */
export function updateTasks(
  ids: readonly number[],
  changes: BulkUpdateChanges,
  db: Db = getDb(),
  changedBy: string | null = null,
  now: Date = new Date(),
): BulkUpdateResult {
  return transaction(db, () => {
    const found = ids.map((id) => getTask(id, db));
    const missingIds = ids.filter((_, i) => found[i] === undefined);
    if (missingIds.length > 0) return { ok: false, missingIds };
    const update = db.prepare(`UPDATE tasks SET status = :status, assignee = :assignee, updated_at = :now, ${COMPLETED_AT_SQL} WHERE id = :id AND deleted_at IS NULL`);
    const recordAssigneeChange = db.prepare(
      "INSERT INTO task_assignee_changes (task_id, from_assignee, to_assignee, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)",
    );
    const changed: { task: Task; updatedAt: string }[] = [];
    for (const task of found as Task[]) {
      const status = changes.status ?? task.status;
      const assignee = changes.assignee ?? task.assignee;
      if (status === task.status && assignee === task.assignee) continue;
      const updatedAt = nextUpdatedAt(task.updatedAt, now);
      update.run({ status, assignee, now: updatedAt, id: task.id });
      if (assignee !== task.assignee) recordAssigneeChange.run(task.id, task.assignee, assignee, changedBy, updatedAt);
      changed.push({ task, updatedAt });
    }
    let undo: BulkUndoTicket = null;
    if (changed.length > 0) {
      const { lastInsertRowid } = db
        .prepare("INSERT INTO bulk_updates (changed_by, changed_at) VALUES (?, ?)")
        .run(changedBy, now.toISOString());
      const id = Number(lastInsertRowid);
      const recordItem = db.prepare(
        "INSERT INTO bulk_update_items (bulk_update_id, task_id, from_status, from_assignee, from_completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const { task, updatedAt } of changed) {
        recordItem.run(id, task.id, task.status, task.assignee, task.completedAt, updatedAt);
      }
      undo = { id, count: changed.length };
    }
    return { ok: true, tasks: ids.map((id) => getTask(id, db)!), undo };
  });
}
