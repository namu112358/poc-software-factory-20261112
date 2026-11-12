import { getDb, type Db } from "./db/index.ts";

export type TaskStatus = "todo" | "in_progress" | "done";

export type Task = {
  id: number;
  title: string;
  status: TaskStatus;
  assignee: string;
  dueDate: string; // YYYY-MM-DD
};

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "未着手",
  in_progress: "進行中",
  done: "完了",
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export type TaskFilter = {
  status?: TaskStatus;
};

type TaskRow = { id: number; title: string; status: TaskStatus; assignee: string; due_date: string };

function toTask(row: TaskRow): Task {
  return { id: row.id, title: row.title, status: row.status, assignee: row.assignee, dueDate: row.due_date };
}

export function listTasks(filter: TaskFilter = {}, db: Db = getDb()): Task[] {
  const rows = db
    .prepare("SELECT id, title, status, assignee, due_date FROM tasks WHERE (:status IS NULL OR status = :status) ORDER BY id")
    .all({ status: filter.status ?? null }) as TaskRow[];
  return rows.map(toTask);
}

export function formatTaskCount(count: number): string {
  return `${count} 件`;
}

export function getTask(id: number, db: Db = getDb()): Task | undefined {
  const row = db.prepare("SELECT id, title, status, assignee, due_date FROM tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  return row && toTask(row);
}

/** URL のパス・クエリの ID を検証する。正の整数でなければ undefined。 */
export function parseTaskId(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) return undefined;
  return Number(value);
}

export type TaskInput = Omit<Task, "id">;

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
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

export function createTask(input: TaskInput, db: Db = getDb()): Task {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO tasks (title, status, assignee, due_date) VALUES (?, ?, ?, ?)")
    .run(input.title, input.status, input.assignee, input.dueDate);
  return getTask(Number(lastInsertRowid), db)!;
}

/** 指定した項目だけを更新する。タスクが無ければ undefined。 */
export function updateTask(id: number, changes: Partial<TaskInput>, db: Db = getDb()): Task | undefined {
  const current = getTask(id, db);
  if (!current) return undefined;
  const next = { ...current, ...changes };
  db.prepare("UPDATE tasks SET title = ?, status = ?, assignee = ?, due_date = ? WHERE id = ?").run(
    next.title,
    next.status,
    next.assignee,
    next.dueDate,
    id,
  );
  return getTask(id, db);
}
