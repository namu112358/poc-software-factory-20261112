import { getDb, type Db } from "./db/index.ts";
import { getTask, type Task } from "./tasks.ts";
import type { ValidationResult } from "./tasks.ts";

export type ExtensionStatus = "pending" | "approved" | "rejected";

export type Extension = {
  id: number;
  taskId: number;
  requester: string;
  newDueDate: string; // YYYY-MM-DD
  reason: string;
  status: ExtensionStatus;
  createdAt: string; // ISO 8601（UTC）
  decidedBy: string | null;
  decidedAt: string | null; // ISO 8601（UTC）
};

type ExtensionRow = {
  id: number;
  task_id: number;
  requester: string;
  new_due_date: string;
  reason: string;
  status: ExtensionStatus;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
};

const SELECT =
  "SELECT id, task_id, requester, new_due_date, reason, status, created_at, decided_by, decided_at FROM due_date_extensions";

function toExtension(row: ExtensionRow): Extension {
  return {
    id: row.id,
    taskId: row.task_id,
    requester: row.requester,
    newDueDate: row.new_due_date,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

export const EXTENSION_REASON_MAX_LENGTH = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD 形式で、実在する日付か。 */
function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 申請の本文（newDueDate・reason）を検証する。理由は前後の空白を除いて 1〜500 文字。 */
export function validateExtensionInput(body: unknown): ValidationResult<{ newDueDate: string; reason: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const b = body as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof b.newDueDate !== "string" || !isValidDate(b.newDueDate)) {
    errors.push("新しい期限は YYYY-MM-DD 形式で入力してください");
  }
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (typeof b.reason !== "string" || reason.length < 1 || reason.length > EXTENSION_REASON_MAX_LENGTH) {
    errors.push(`理由は 1〜${EXTENSION_REASON_MAX_LENGTH} 文字で入力してください`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { newDueDate: b.newDueDate as string, reason } };
}

/** タスクの延長申請を、申請の古い順に返す。 */
export function listExtensions(taskId: number, db: Db = getDb()): Extension[] {
  const rows = db.prepare(`${SELECT} WHERE task_id = ? ORDER BY id`).all(taskId) as ExtensionRow[];
  return rows.map(toExtension);
}

export function getExtension(id: number, db: Db = getDb()): Extension | undefined {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as ExtensionRow | undefined;
  return row && toExtension(row);
}

/** 延長を申請する。保留中の申請がすでにあれば "conflict"。 */
export function createExtension(
  input: { taskId: number; requester: string; newDueDate: string; reason: string },
  db: Db = getDb(),
  now: Date = new Date(),
): Extension | "conflict" {
  const pending = db
    .prepare("SELECT 1 FROM due_date_extensions WHERE task_id = ? AND status = 'pending'")
    .get(input.taskId);
  if (pending) return "conflict";
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO due_date_extensions (task_id, requester, new_due_date, reason, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    )
    .run(input.taskId, input.requester, input.newDueDate, input.reason, now.toISOString());
  return getExtension(Number(lastInsertRowid), db)!;
}

export type DecideResult =
  | { result: "decided"; extension: Extension; task: Task }
  | { result: "not_found" }
  | { result: "conflict" }; // すでに判断済み

/** 申請を承認（approved）または却下（rejected）する。承認のときはタスクの期限も変える。 */
export function decideExtension(
  taskId: number,
  extensionId: number,
  decision: "approved" | "rejected",
  userId: string,
  db: Db = getDb(),
  now: Date = new Date(),
): DecideResult {
  const current = getExtension(extensionId, db);
  if (!current || current.taskId !== taskId) return { result: "not_found" };
  if (current.status !== "pending") return { result: "conflict" };
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE due_date_extensions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?").run(
      decision,
      userId,
      now.toISOString(),
      extensionId,
    );
    if (decision === "approved") {
      db.prepare("UPDATE tasks SET due_date = ? WHERE id = ?").run(current.newDueDate, taskId);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { result: "decided", extension: getExtension(extensionId, db)!, task: getTask(taskId, db)! };
}
