// タスクの担当者の変更の履歴。記録は task-store.ts のタスクの更新が行い、ここでは読み出しと表示の形を扱う。
import { getDb, type Db } from "./db/index.ts";
import { formatJstDateTime } from "./task-format.ts";

export type AssigneeChange = {
  id: number;
  taskId: number;
  fromAssignee: string;
  fromName: string | null;
  toAssignee: string;
  toName: string | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string; // ISO 8601（UTC）
};

/** タスクの担当者の変更の履歴を、新しい順（同じ時刻なら後から記録した順）に返す。 */
export function listAssigneeChanges(taskId: number, db: Db = getDb()): AssigneeChange[] {
  return db
    .prepare(
      `SELECT c.id AS id, c.task_id AS taskId,
              c.from_assignee AS fromAssignee, f.name AS fromName,
              c.to_assignee AS toAssignee, t.name AS toName,
              c.changed_by AS changedBy, b.name AS changedByName,
              c.changed_at AS changedAt
         FROM task_assignee_changes c
         LEFT JOIN users f ON f.id = c.from_assignee
         LEFT JOIN users t ON t.id = c.to_assignee
         LEFT JOIN users b ON b.id = c.changed_by
        WHERE c.task_id = ?
        ORDER BY c.changed_at DESC, c.id DESC`,
    )
    .all(taskId) as AssigneeChange[];
}

/** 利用者の表示名。名前が分かれば名前、無ければ ID、ID も空なら「（なし）」。 */
function displayName(id: string | null, name: string | null, empty: string): string {
  if (name !== null) return name;
  if (id === null || id === "") return empty;
  return id;
}

/** 履歴 1 件の表示。例: 「2026/11/12 18:05 佐藤 が 鈴木 → 田中 に変更」（日時は日本時間）。 */
export function formatAssigneeChange(change: AssigneeChange): string {
  const by = displayName(change.changedBy, change.changedByName, "（不明）");
  const from = displayName(change.fromAssignee, change.fromName, "（なし）");
  const to = displayName(change.toAssignee, change.toName, "（なし）");
  return `${formatJstDateTime(change.changedAt)} ${by} が ${from} → ${to} に変更`;
}

export type NewlyAssignedTask = {
  taskId: number;
  title: string;
  fromAssignee: string;
  fromName: string | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string; // ISO 8601（UTC）
};

/**
 * 前回のログイン（previousLoginAt の後）から今回のログイン（loginAt まで）の間に、userId の担当に替えられたタスク。
 * 担当は今回のログインの時点で判定する: そのタスクの loginAt までで最新の担当の変更が、期間内の userId への変更であるものだけ。
 * ログインのあとに担当が変わっても、一覧は変わらない。未完了・アーカイブしていないものだけ。自分で自分の担当にしたものは除く。新しい順。
 * 前回のログインまたは今回のログインの日時が分からなければ、空にする。
 */
export function listNewlyAssignedTasks(
  userId: string,
  previousLoginAt: string | null | undefined,
  loginAt: string | null | undefined,
  db: Db = getDb(),
): NewlyAssignedTask[] {
  if (!previousLoginAt || !loginAt) return [];
  return db
    .prepare(
      `SELECT t.id AS taskId, t.title AS title,
              c.from_assignee AS fromAssignee, f.name AS fromName,
              c.changed_by AS changedBy, b.name AS changedByName,
              c.changed_at AS changedAt
         FROM tasks t
         JOIN task_assignee_changes c
           ON c.id = (SELECT c2.id FROM task_assignee_changes c2
                       WHERE c2.task_id = t.id AND c2.changed_at <= ?
                       ORDER BY c2.changed_at DESC, c2.id DESC LIMIT 1)
         LEFT JOIN users f ON f.id = c.from_assignee
         LEFT JOIN users b ON b.id = c.changed_by
        WHERE c.to_assignee = ? AND c.changed_at > ?
          AND t.status <> 'done' AND t.archived = 0 AND t.deleted_at IS NULL
          AND (c.changed_by IS NULL OR c.changed_by <> ?)
        ORDER BY c.changed_at DESC, c.id DESC`,
    )
    .all(loginAt, userId, previousLoginAt, userId) as NewlyAssignedTask[];
}

/** 一覧の 1 行の「前の担当者」「替えた人」の表示。 */
export function newlyAssignedNames(row: NewlyAssignedTask): { from: string; by: string } {
  return {
    from: displayName(row.fromAssignee, row.fromName, "（なし）"),
    by: displayName(row.changedBy, row.changedByName, "（不明）"),
  };
}

export const NEWLY_ASSIGNED_HEADING = (count: number) => `新しく担当になったタスク（${count} 件）`;
