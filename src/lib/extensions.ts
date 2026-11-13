import { getDb, type Db } from "./db/index.ts";
import { getTask, type Task } from "./tasks.ts";
import type { ValidationResult } from "./tasks.ts";
import { isCoordinator } from "./users.ts";

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

export const EXTENSION_NOT_AFTER_MESSAGE = "希望の期限は、今の期限より後の日付にしてください";

/** 申請の本文（newDueDate・reason）を検証する。希望の期限は、タスクの今の期限より後の日付だけ。理由は前後の空白を除いて 1〜500 文字。 */
export function validateExtensionInput(body: unknown, currentDueDate: string): ValidationResult<{ newDueDate: string; reason: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const b = body as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof b.newDueDate !== "string" || !isValidDate(b.newDueDate)) {
    errors.push("新しい期限は YYYY-MM-DD 形式で入力してください");
  } else if (b.newDueDate <= currentDueDate) {
    errors.push(EXTENSION_NOT_AFTER_MESSAGE);
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
  | { result: "decided"; extension: Extension; task: Task; dueDateChanged: boolean } // dueDateChanged: 承認でタスクの期限を変えたか（却下は常に false）
  | { result: "not_found" }
  | { result: "forbidden"; reason: "own" } // 申請した本人（自分の申請は自分で判断できない）
  | { result: "forbidden"; reason: "not_coordinator" } // 取りまとめる人ではない
  | { result: "conflict" }; // すでに判断済み

/** 判断できないとき（403）の理由ごとの文言。 */
export const DECIDE_FORBIDDEN_MESSAGE: Record<"own" | "not_coordinator", string> = {
  own: "自分の申請は判断できません",
  not_coordinator: "延長の申請を判断できるのは取りまとめる人だけです",
};

/**
 * 申請を承認（approved）または却下（rejected）する。承認のときはタスクの期限も変える。判断できるのは取りまとめる人だけ。
 * 判定の順は「申請が無い（not_found）→ 申請した本人（forbidden）→ 取りまとめる人でない（forbidden）→ 判断済み（conflict）」。
 * 取りまとめる人でない人には、判断済みかどうかを知らせない（409 より先に 403）。
 * 申請の更新は保留中のときだけ行い、先にほかの人が判断していればタスクも変えずに conflict を返す。
 * 承認でも、タスクの今の期限が希望の期限以降（申請の後で後ろへ変えられた）なら、期限も最終更新日時も変えずに承認として閉じる。
 * 期限を変えるかの判定と書き込みは 1 つの UPDATE 文の条件で行い、読んでから書くまでに期限が編集されても縮めない。
 */
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
  if (current.requester === userId) return { result: "forbidden", reason: "own" };
  if (!isCoordinator(userId, db)) return { result: "forbidden", reason: "not_coordinator" };
  if (current.status !== "pending") return { result: "conflict" };
  let dueDateChanged = false;
  db.exec("BEGIN");
  try {
    const { changes } = db
      .prepare(
        "UPDATE due_date_extensions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(decision, userId, now.toISOString(), extensionId);
    if (Number(changes) === 0) {
      db.exec("ROLLBACK");
      return { result: "conflict" };
    }
    if (decision === "approved") {
      const updated = db
        .prepare("UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND due_date < ?")
        .run(current.newDueDate, now.toISOString(), taskId, current.newDueDate);
      dueDateChanged = Number(updated.changes) > 0;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { result: "decided", extension: getExtension(extensionId, db)!, task: getTask(taskId, db)!, dueDateChanged };
}

/** 今の期限が希望の期限以降で、承認しても期限が変わらないか（YYYY-MM-DD の文字列で比べる）。 */
export function isAlreadyExtended(currentDueDate: string, newDueDate: string): boolean {
  return currentDueDate >= newDueDate;
}

/** 承認したが期限を変えなかったときに、承認した人へ出す説明。 */
export function dueDateUnchangedNotice(currentDueDate: string, newDueDate: string): string {
  return `タスクの期限（${currentDueDate}）がすでに希望の期限（${newDueDate}）以降のため、期限は変えずに承認しました`;
}

export type ApproveResponse = { extension: Extension; task: Task; dueDateChanged: boolean; notice?: string };

/** 承認の API の応答の本文。期限を変えなかったときは、その理由（notice）を付ける。 */
export function approveResponse(decided: { extension: Extension; task: Task; dueDateChanged: boolean }): ApproveResponse {
  const { extension, task, dueDateChanged } = decided;
  if (dueDateChanged) return { extension, task, dueDateChanged };
  return { extension, task, dueDateChanged, notice: dueDateUnchangedNotice(task.dueDate, extension.newDueDate) };
}

export type WithdrawResult =
  | { result: "withdrawn"; extension: Extension }
  | { result: "not_found" } // 申請が無い、または別のタスクの申請
  | { result: "forbidden" } // 申請した本人ではない
  | { result: "conflict" }; // すでに判断済み

/**
 * 保留中の申請を、申請した本人が取り下げる（申請は消える）。
 * 消すかどうかの判定と削除を 1 回の DELETE で行い、判定の後に承認・却下された申請を消さない。
 */
export function withdrawExtension(
  taskId: number,
  extensionId: number,
  userId: string,
  db: Db = getDb(),
): WithdrawResult {
  const deleted = db
    .prepare(
      "DELETE FROM due_date_extensions WHERE id = ? AND task_id = ? AND requester = ? AND status = 'pending' RETURNING id, task_id, requester, new_due_date, reason, status, created_at, decided_by, decided_at",
    )
    .get(extensionId, taskId, userId) as ExtensionRow | undefined;
  if (deleted) return { result: "withdrawn", extension: toExtension(deleted) };
  const current = getExtension(extensionId, db);
  if (!current || current.taskId !== taskId) return { result: "not_found" };
  if (current.requester !== userId) return { result: "forbidden" };
  return { result: "conflict" };
}

export type PendingExtensionRow = {
  id: number;
  taskId: number;
  taskTitle: string;
  requester: string; // 申請者の ID
  requesterName: string; // 申請者の表示名（利用者が見つからなければ ID）
  currentDueDate: string; // タスクの今の期限 YYYY-MM-DD
  newDueDate: string; // 希望の期限 YYYY-MM-DD
  alreadyExtended: boolean; // 今の期限がすでに希望の期限以降（承認しても期限は変わらない）
  reason: string;
  createdAt: string; // ISO 8601（UTC）
};

/** 承認待ち（pending）の延長申請を、申請の古い順に返す。タスクの題名・今の期限・申請者の名前つき。 */
export function listPendingExtensions(db: Db = getDb()): PendingExtensionRow[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.task_id, t.title, e.requester, u.name AS requester_name, t.due_date, e.new_due_date, e.reason, e.created_at
       FROM due_date_extensions e
       JOIN tasks t ON t.id = e.task_id
       LEFT JOIN users u ON u.id = e.requester
       WHERE e.status = 'pending' AND t.deleted_at IS NULL
       ORDER BY e.created_at, e.id`,
    )
    .all() as {
    id: number;
    task_id: number;
    title: string;
    requester: string;
    requester_name: string | null;
    due_date: string;
    new_due_date: string;
    reason: string;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    taskTitle: r.title,
    requester: r.requester,
    requesterName: r.requester_name ?? r.requester,
    currentDueDate: r.due_date,
    newDueDate: r.new_due_date,
    alreadyExtended: isAlreadyExtended(r.due_date, r.new_due_date),
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/** 申請日時の表示。日本時間の「YYYY/MM/DD HH:mm」。 */
export function formatExtensionRequestedAt(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

export const MY_EXTENSIONS_DAYS = 30;

export type MyExtensionRow = {
  id: number;
  taskId: number;
  taskTitle: string;
  newDueDate: string; // 希望の期限 YYYY-MM-DD
  status: ExtensionStatus;
  createdAt: string; // ISO 8601（UTC）
  decidedByName: string | null; // 判断した人の表示名（利用者が見つからなければ ID）。判断前・不明なら null
  decidedAt: string | null; // ISO 8601（UTC）。判断前・不明なら null
};

/** 自分が出した延長申請を、直近 30 日分、申請の新しい順に返す（承認待ち・承認・却下のすべて）。 */
export function listMyExtensions(userId: string, db: Db = getDb(), now: Date = new Date()): MyExtensionRow[] {
  const since = new Date(now.getTime() - MY_EXTENSIONS_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT e.id, e.task_id, t.title, e.new_due_date, e.status, e.created_at, e.decided_by, d.name AS decided_by_name, e.decided_at
       FROM due_date_extensions e
       JOIN tasks t ON t.id = e.task_id
       LEFT JOIN users d ON d.id = e.decided_by
       WHERE e.requester = ? AND e.created_at >= ? AND t.deleted_at IS NULL
       ORDER BY e.created_at DESC, e.id DESC`,
    )
    .all(userId, since) as {
    id: number;
    task_id: number;
    title: string;
    new_due_date: string;
    status: ExtensionStatus;
    created_at: string;
    decided_by: string | null;
    decided_by_name: string | null;
    decided_at: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    taskTitle: r.title,
    newDueDate: r.new_due_date,
    status: r.status,
    createdAt: r.created_at,
    decidedByName: r.decided_by === null ? null : (r.decided_by_name ?? r.decided_by),
    decidedAt: r.decided_at,
  }));
}

const EXTENSION_STATUS_LABEL: Record<ExtensionStatus, string> = {
  pending: "承認待ち",
  approved: "承認",
  rejected: "却下",
};

/** 申請の結果の日本語表示。 */
export function extensionStatusLabel(status: ExtensionStatus): string {
  return EXTENSION_STATUS_LABEL[status];
}

export const LONG_WAIT_HOURS = 48;
const HOUR_MS = 60 * 60 * 1000;

/** 申請から 48 時間以上たっていれば、待っている日数（切り捨て）を返す。48 時間に満たなければ null。UTC の時刻で比べる。 */
export function longWaitDays(createdAt: string, now: Date = new Date()): number | null {
  const elapsed = now.getTime() - new Date(createdAt).getTime();
  if (Number.isNaN(elapsed) || elapsed < LONG_WAIT_HOURS * HOUR_MS) return null;
  return Math.floor(elapsed / (24 * HOUR_MS));
}

/** 承認待ちの申請のうち、48 時間以上待っているものの数。 */
export function countLongWaiting(createdAts: string[], now: Date = new Date()): number {
  return createdAts.filter((c) => longWaitDays(c, now) !== null).length;
}
