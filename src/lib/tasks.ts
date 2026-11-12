import { getDb, type Db } from "./db/index.ts";

export type TaskStatus = "todo" | "in_progress" | "done";

export type TaskPriority = "high" | "medium" | "low";

export type Task = {
  id: number;
  title: string;
  status: TaskStatus;
  assignee: string;
  dueDate: string; // YYYY-MM-DD
  priority: TaskPriority;
  estimateMinutes: number | null; // 見積もり時間（分）。未設定は null
  memo: string; // メモ（詳しい説明）。0〜2000 文字。既定は空文字
};

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "未着手",
  in_progress: "進行中",
  done: "完了",
};

export const TASK_PRIORITIES: readonly TaskPriority[] = ["high", "medium", "low"];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export type TaskSort = "created" | "priority";

export const TASK_SORTS: readonly TaskSort[] = ["created", "priority"];

export const SORT_LABELS: Record<TaskSort, string> = {
  created: "作成順",
  priority: "優先度の高い順",
};

/** URL のクエリの並び順を検証する。不正な値は「作成順」として扱う。 */
export function parseSort(value: unknown): TaskSort {
  return typeof value === "string" && (TASK_SORTS as readonly string[]).includes(value) ? (value as TaskSort) : "created";
}

export type TaskFilter = {
  status?: TaskStatus;
  assignee?: string;
  tag?: string;
  sort?: TaskSort;
};

export type Assignee = { id: string; name: string };

/** タスクに登場する担当者（重複なし）。 */
export function listAssignees(db: Db = getDb()): Assignee[] {
  return db
    .prepare(
      "SELECT DISTINCT u.id AS id, u.name AS name FROM tasks t JOIN users u ON u.id = t.assignee ORDER BY u.id",
    )
    .all() as Assignee[];
}

/** クエリの担当者 ID を検証する。タスクに登場する担当者でなければ undefined（指定なし）。 */
export function parseAssignee(value: unknown, db: Db = getDb()): string | undefined {
  if (typeof value !== "string") return undefined;
  return listAssignees(db).some((a) => a.id === value) ? value : undefined;
}

type TaskRow = {
  id: number;
  title: string;
  status: TaskStatus;
  assignee: string;
  due_date: string;
  priority: TaskPriority;
  estimate_minutes: number | null;
  memo: string;
};

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    assignee: row.assignee,
    dueDate: row.due_date,
    priority: row.priority,
    estimateMinutes: row.estimate_minutes,
    memo: row.memo,
  };
}

export function listTasks(filter: TaskFilter = {}, db: Db = getDb()): Task[] {
  const orderBy =
    filter.sort === "priority"
      ? "ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id"
      : "ORDER BY id";
  const rows = db
    .prepare(
      "SELECT id, title, status, assignee, due_date, priority, estimate_minutes, memo FROM tasks WHERE (:status IS NULL OR status = :status) AND (:assignee IS NULL OR assignee = :assignee) AND (:tag IS NULL OR EXISTS (SELECT 1 FROM task_tags g WHERE g.task_id = tasks.id AND g.name = :tag)) " + orderBy,
    )
    .all({ status: filter.status ?? null, assignee: filter.assignee ?? null, tag: filter.tag ?? null }) as TaskRow[];
  return rows.map(toTask);
}

/** URL のクエリのタグ名を検証する。前後の空白を取り除き、空なら undefined（指定なし）。 */
export function parseTagFilter(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function formatTaskCount(count: number): string {
  return `${count} 件`;
}

export function getTask(id: number, db: Db = getDb()): Task | undefined {
  const row = db.prepare("SELECT id, title, status, assignee, due_date, priority, estimate_minutes, memo FROM tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  return row && toTask(row);
}

/** URL のパス・クエリの ID を検証する。正の整数でなければ undefined。 */
export function parseTaskId(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) return undefined;
  return Number(value);
}

export type TaskInput = Omit<Task, "id" | "priority" | "estimateMinutes" | "memo"> & {
  priority?: TaskPriority;
  estimateMinutes?: number | null;
  memo?: string;
};

export const MEMO_MAX_LENGTH = 2000;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * API に送られたタスクの内容を検証する。partial = true（更新）のときは、送られた項目だけを検証する。
 * 担当者が存在するかは DB で確認する。
 */
export function validateTaskInput(
  body: unknown,
  options: { partial?: boolean } = {},
  db: Db = getDb(),
): ValidationResult<Partial<TaskInput>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const b = body as Record<string, unknown>;
  const errors: string[] = [];
  const value: Partial<TaskInput> = {};
  const need = (key: string) => !options.partial || key in b;

  if (need("title")) {
    if (typeof b.title !== "string" || b.title.trim() === "" || b.title.length > 200) {
      errors.push("タイトルは 1〜200 文字で入力してください");
    } else value.title = b.title.trim();
  }
  if (need("status")) {
    if (!isTaskStatus(b.status)) errors.push("ステータスが正しくありません");
    else value.status = b.status;
  }
  if (need("assignee")) {
    const exists =
      typeof b.assignee === "string" && db.prepare("SELECT 1 FROM users WHERE id = ?").get(b.assignee) !== undefined;
    if (!exists) errors.push("担当者が存在しません");
    else value.assignee = b.assignee as string;
  }
  if (need("dueDate")) {
    if (typeof b.dueDate !== "string" || !DATE_RE.test(b.dueDate) || Number.isNaN(Date.parse(b.dueDate))) {
      errors.push("期限は YYYY-MM-DD 形式で入力してください");
    } else value.dueDate = b.dueDate;
  }
  if ("priority" in b) {
    if (!isTaskPriority(b.priority)) errors.push("優先度は high・medium・low のいずれかにしてください");
    else value.priority = b.priority;
  }
  if ("estimateMinutes" in b) {
    const m = b.estimateMinutes;
    if (m === null) value.estimateMinutes = null;
    else if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 10000) {
      errors.push("見積もり時間は 1〜10000 の整数（分）で入力してください");
    } else value.estimateMinutes = m;
  }
  if ("memo" in b) {
    if (typeof b.memo !== "string" || b.memo.length > MEMO_MAX_LENGTH) {
      errors.push(`メモは ${MEMO_MAX_LENGTH} 文字以内の文字列で入力してください`);
    } else value.memo = b.memo;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

export function createTask(input: TaskInput, db: Db = getDb()): Task {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO tasks (title, status, assignee, due_date, priority, estimate_minutes, memo) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(input.title, input.status, input.assignee, input.dueDate, input.priority ?? "medium", input.estimateMinutes ?? null, input.memo ?? "");
  return getTask(Number(lastInsertRowid), db)!;
}

/** 指定した項目だけを更新する。タスクが無ければ undefined。 */
export function updateTask(id: number, changes: Partial<TaskInput>, db: Db = getDb()): Task | undefined {
  const current = getTask(id, db);
  if (!current) return undefined;
  const next = { ...current, ...changes };
  db.prepare("UPDATE tasks SET title = ?, status = ?, assignee = ?, due_date = ?, priority = ?, estimate_minutes = ?, memo = ? WHERE id = ?").run(
    next.title,
    next.status,
    next.assignee,
    next.dueDate,
    next.priority,
    next.estimateMinutes,
    next.memo,
    id,
  );
  return getTask(id, db);
}

/** 見積もり時間の表示用の文字列。未設定は「—」。 */
export function formatEstimate(minutes: number | null): string {
  return minutes === null ? "—" : `${minutes} 分`;
}

const MEMO_PREVIEW_LENGTH = 30;

/** 一覧に出すメモの冒頭。改行は空白 1 つにし、30 文字を超えたら「…」を付ける。空のメモは null。 */
export function formatMemoPreview(memo: string): string | null {
  if (memo === "") return null;
  const chars = Array.from(memo.replace(/\r\n|\r|\n/g, " "));
  if (chars.length <= MEMO_PREVIEW_LENGTH) return chars.join("");
  return chars.slice(0, MEMO_PREVIEW_LENGTH).join("") + "…";
}
