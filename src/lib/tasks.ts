import { getDb, transaction, type Db } from "./db/index.ts";

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
  createdAt: string; // ISO 8601（UTC）
  updatedAt: string; // ISO 8601（UTC）
  completedAt: string | null; // 完了にした日時。ISO 8601（UTC）。完了していなければ null
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

/** 「担当者なし」を表す絞り込みの値。 */
export const UNASSIGNED = "none";

export type Assignee = { id: string; name: string };

/** タスクに登場する担当者（重複なし）。 */
export function listAssignees(db: Db = getDb()): Assignee[] {
  return db
    .prepare(
      "SELECT DISTINCT u.id AS id, u.name AS name FROM tasks t JOIN users u ON u.id = t.assignee ORDER BY u.id",
    )
    .all() as Assignee[];
}

/** 一覧に出す担当者の名前。担当者の一覧に無い ID（通常は起きない）は ID のまま、担当者なしは空文字。 */
export function assigneeName(assignee: string | null | undefined, assignees: Assignee[]): string {
  if (!assignee) return "";
  return assignees.find((a) => a.id === assignee)?.name ?? assignee;
}

/** クエリの担当者 ID を検証する。`none`（担当者なし）かタスクに登場する担当者でなければ undefined（指定なし）。 */
export function parseAssignee(value: unknown, db: Db = getDb()): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value === UNASSIGNED) return UNASSIGNED;
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
  created_at: string;
  updated_at: string;
  completed_at: string | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
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
      "SELECT id, title, status, assignee, due_date, priority, estimate_minutes, created_at, updated_at, completed_at, memo FROM tasks WHERE (:status IS NULL OR status = :status) AND (:assignee IS NULL OR (:assignee = 'none' AND assignee IS NULL) OR (:assignee <> 'none' AND assignee = :assignee)) AND (:tag IS NULL OR EXISTS (SELECT 1 FROM task_tags g WHERE g.task_id = tasks.id AND g.name = :tag)) " + orderBy,
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

export const TASK_LIST_HELP = "ステータス・担当者・タグで絞り込み、優先度の高い順に並べ替えられます。";

export function formatTaskCount(count: number): string {
  return `${count} 件`;
}

/** 一覧の見出しの下に出す、ログイン中のユーザーの表示。ログイン ID ではなく表示名を使う。 */
export function formatCurrentUser(name: string): string {
  return `ログイン中: ${name}`;
}

export function getTask(id: number, db: Db = getDb()): Task | undefined {
  const row = db.prepare("SELECT id, title, status, assignee, due_date, priority, estimate_minutes, created_at, updated_at, completed_at, memo FROM tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  return row && toTask(row);
}

/** URL のパス・クエリの ID を検証する。正の整数でなければ undefined。 */
export function parseTaskId(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) return undefined;
  return Number(value);
}

export type TaskInput = Omit<Task, "id" | "priority" | "estimateMinutes" | "memo" | "createdAt" | "updatedAt" | "completedAt"> & {
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
  const now = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare("INSERT INTO tasks (title, status, assignee, due_date, priority, estimate_minutes, memo, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.title, input.status, input.assignee, input.dueDate, input.priority ?? "medium", input.estimateMinutes ?? null, input.memo ?? "", now, now, input.status === "done" ? now : null);
  return getTask(Number(lastInsertRowid), db)!;
}

/**
 * UPDATE 文の SET に使う、完了日時の式。`:status` は更新後のステータス、`:now` は更新の時刻。
 * 完了以外にするなら NULL、すでに完了なら今の値のまま、完了にするなら `:now`。
 * 更新前の行のステータスを UPDATE 文の中で見るので、読んでから書くまでに別の更新が入ってもずれない。
 */
export const COMPLETED_AT_SQL =
  "completed_at = CASE WHEN :status <> 'done' THEN NULL WHEN status = 'done' THEN completed_at ELSE :now END";

/** 指定した項目だけを更新する。タスクが無ければ undefined。完了日時はステータスの変化に合わせて決まる。 */
export function updateTask(id: number, changes: Partial<TaskInput>, db: Db = getDb()): Task | undefined {
  const current = getTask(id, db);
  if (!current) return undefined;
  const next = { ...current, ...changes };
  db.prepare(
    `UPDATE tasks SET title = :title, status = :status, assignee = :assignee, due_date = :dueDate, priority = :priority, estimate_minutes = :estimateMinutes, memo = :memo, updated_at = :now, ${COMPLETED_AT_SQL} WHERE id = :id`,
  ).run({
    title: next.title,
    status: next.status,
    assignee: next.assignee,
    dueDate: next.dueDate,
    priority: next.priority,
    estimateMinutes: next.estimateMinutes,
    memo: next.memo,
    now: new Date().toISOString(),
    id,
  });
  return getTask(id, db);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 日本時間の「今日」を YYYY-MM-DD で返す。 */
export function todayInJapan(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
}

/** 期限までの残り日数の表示文言。完了したタスクは undefined（表示しない）。 */
export function formatDaysLeft(
  task: Pick<Task, "status" | "dueDate">,
  today: string = todayInJapan(),
): string | undefined {
  if (task.status === "done") return undefined;
  const diff = Math.round((Date.parse(task.dueDate) - Date.parse(today)) / MS_PER_DAY);
  if (Number.isNaN(diff)) return undefined;
  if (diff > 0) return `あと ${diff} 日`;
  if (diff === 0) return "今日まで";
  return `${-diff} 日超過`;
}

/** 期限切れか。未完了で、期限日の翌日以降（期限当日は含めない）。日付は日本時間の YYYY-MM-DD。 */
export function isOverdue(task: Pick<Task, "status" | "dueDate">, today: string = todayInJapan()): boolean {
  return task.status !== "done" && task.dueDate < today;
}

/** 表示中のタスクのうち、期限切れ（`isOverdue`）の数。 */
export function countOverdue(tasks: Pick<Task, "status" | "dueDate">[], today: string = todayInJapan()): number {
  return tasks.filter((t) => isOverdue(t, today)).length;
}

/** 期限切れの件数の表示。0 件のときは null（表示しない）。 */
export function formatOverdueCount(count: number): string | null {
  return count > 0 ? `期限切れ ${count} 件` : null;
}

/** 一覧の行に付ける属性。完了したタスクだけ `data-done="true"` を付ける。 */
export function taskRowDoneAttr(status: TaskStatus): { "data-done"?: "true" } {
  return status === "done" ? { "data-done": "true" } : {};
}

/** 優先度の欄の文字の太さ。「高」だけ太字にする。 */
export function priorityFontWeight(priority: TaskPriority): "bold" | undefined {
  return priority === "high" ? "bold" : undefined;
}

/** 見積もり時間の表示用の文字列。未設定は「—」。 */
export function formatEstimate(minutes: number | null): string {
  return minutes === null ? "—" : `${minutes} 分`;
}

/** 見積もり時間（分）の合計。未設定（null）のタスクは数えない。 */
export function sumEstimateMinutes(tasks: { estimateMinutes: number | null }[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);
}

/** 合計の表示用の文字列。60 分未満は「M 分」、それ以上は「H 時間 M 分」（ちょうど何時間でも「H 時間 0 分」）。 */
export function formatEstimateTotal(minutes: number): string {
  if (minutes < 60) return `${minutes} 分`;
  return `${Math.floor(minutes / 60)} 時間 ${minutes % 60} 分`;
}

/** タスクの番号の表示用の文字列（例: #3）。 */
export function formatTaskNumber(id: number): string {
  return `#${id}`;
}

const MEMO_PREVIEW_LENGTH = 30;

/** 一覧に出すメモの冒頭。改行は空白 1 つにし、30 文字を超えたら「…」を付ける。空のメモは null。 */
export function formatMemoPreview(memo: string): string | null {
  if (memo === "") return null;
  const chars = Array.from(memo.replace(/\r\n|\r|\n/g, " "));
  if (chars.length <= MEMO_PREVIEW_LENGTH) return chars.join("");
  return chars.slice(0, MEMO_PREVIEW_LENGTH).join("") + "…";
}

/** 一覧のタイトルのリンクに `title` 属性として付けるメモの全文。空のメモは undefined（属性を付けない）。 */
export function memoTooltip(memo: string): string | undefined {
  return memo === "" ? undefined : memo;
}

/** ISO 8601（UTC）の日時を、日本時間の「YYYY/MM/DD HH:mm」にする。解釈できなければ「—」。 */
export function formatJstDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const jst = new Date(t + 9 * 60 * 60 * 1000).toISOString();
  return `${jst.slice(0, 10).replaceAll("-", "/")} ${jst.slice(11, 16)}`;
}

/** ISO 8601（UTC）の日時を、日本時間の日付「YYYY-MM-DD」にする。解釈できなければ「—」。 */
export function formatJstDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * タスクを複製する。タイトル・担当者・期限・優先度・見積もり時間・タグを写し、ステータスは常に todo。
 * コメントと延長申請は写さない。元のタスクが無ければ undefined。
 */
export function duplicateTask(id: number, db: Db = getDb()): Task | undefined {
  const source = getTask(id, db);
  if (!source) return undefined;
  const copy = createTask(
    {
      title: source.title,
      status: "todo",
      assignee: source.assignee,
      dueDate: source.dueDate,
      priority: source.priority,
      estimateMinutes: source.estimateMinutes,
    },
    db,
  );
  db.prepare("INSERT INTO task_tags (task_id, name) SELECT ?, name FROM task_tags WHERE task_id = ? ORDER BY id").run(copy.id, id);
  return copy;
}

/** まとめて完了にできるタスクの最大件数。 */
export const BULK_COMPLETE_MAX = 100;

/**
 * まとめて完了にする API の本文を検証する。`ids` は 1〜100 件の正の整数の配列。
 * 重複した ID は 1 件にまとめ、送られた順（初出順）で返す。
 */
export function validateBulkCompleteInput(body: unknown): ValidationResult<number[]> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const ids = (body as Record<string, unknown>).ids;
  if (ids === undefined) return { ok: false, errors: ["ids を指定してください"] };
  if (!Array.isArray(ids)) return { ok: false, errors: ["ids はタスクの ID の配列で指定してください"] };
  if (ids.length === 0) return { ok: false, errors: ["ids に 1 件以上の ID を指定してください"] };
  if (!ids.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
    return { ok: false, errors: ["ids には正の整数だけを指定してください"] };
  }
  const unique = [...new Set(ids as number[])];
  if (unique.length > BULK_COMPLETE_MAX) {
    return { ok: false, errors: [`ids は ${BULK_COMPLETE_MAX} 件以内で指定してください`] };
  }
  return { ok: true, value: unique };
}

export type BulkCompleteResult = { ok: true; tasks: Task[] } | { ok: false; missingIds: number[] };

/**
 * 指定したタスクをまとめて完了（done）にする。全部か無しか: 存在しない ID が 1 つでもあれば、何も変えない。
 * すでに完了のタスクは変えない（最終更新日時・完了日時もそのまま）。完了にしたタスクには完了日時を記録する。結果は ids の順に並べる。
 */
export function completeTasks(ids: readonly number[], db: Db = getDb()): BulkCompleteResult {
  return transaction(db, () => {
    const found = ids.map((id) => getTask(id, db));
    const missingIds = ids.filter((_, i) => found[i] === undefined);
    if (missingIds.length > 0) return { ok: false, missingIds };
    const now = new Date().toISOString();
    const update = db.prepare("UPDATE tasks SET status = 'done', updated_at = ?, completed_at = ? WHERE id = ? AND status <> 'done'");
    for (const id of ids) update.run(now, now, id);
    return { ok: true, tasks: ids.map((id) => getTask(id, db)!) };
  });
}
