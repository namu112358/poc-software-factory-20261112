import { getDb, transaction, type Db } from "./db/index.ts";
import type { Assignee, Task, TaskFilter, TaskInput, TaskPriority, TaskStatus } from "./task-types.ts";

/** タスクに登場する担当者（重複なし）。 */
export function listAssignees(db: Db = getDb()): Assignee[] {
  return db
    .prepare(
      "SELECT DISTINCT u.id AS id, u.name AS name FROM tasks t JOIN users u ON u.id = t.assignee ORDER BY u.id",
    )
    .all() as Assignee[];
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
  archived: number;
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
    archived: row.archived === 1,
  };
}

export function listTasks(filter: TaskFilter = {}, db: Db = getDb()): Task[] {
  const orderBy =
    filter.sort === "priority"
      ? "ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id"
      : "ORDER BY id";
  const rows = db
    .prepare(
      "SELECT id, title, status, assignee, due_date, priority, estimate_minutes, created_at, updated_at, completed_at, memo, archived FROM tasks WHERE (:includeArchived = 1 OR archived = 0) AND (:status IS NULL OR status = :status) AND (:assignee IS NULL OR (:assignee = 'none' AND assignee IS NULL) OR (:assignee <> 'none' AND assignee = :assignee)) AND (:tag IS NULL OR EXISTS (SELECT 1 FROM task_tags g WHERE g.task_id = tasks.id AND g.name = :tag)) AND (:q IS NULL OR title LIKE :q ESCAPE '\\' OR memo LIKE :q ESCAPE '\\') " + orderBy,
    )
    .all({ status: filter.status ?? null, assignee: filter.assignee ?? null, tag: filter.tag ?? null, q: filter.q === undefined ? null : likePattern(filter.q), includeArchived: filter.includeArchived ? 1 : 0 }) as TaskRow[];
  return rows.map(toTask);
}

/** キーワードを、含むかどうかの LIKE のパターンにする。`%`・`_`・`\` はその文字そのものとして扱う。 */
function likePattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, "\\$&")}%`;
}

export function getTask(id: number, db: Db = getDb()): Task | undefined {
  const row = db.prepare("SELECT id, title, status, assignee, due_date, priority, estimate_minutes, created_at, updated_at, completed_at, memo, archived FROM tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  return row && toTask(row);
}

export function createTask(input: TaskInput, db: Db = getDb()): Task {
  const now = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare("INSERT INTO tasks (title, status, assignee, due_date, priority, estimate_minutes, memo, archived, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.title, input.status, input.assignee, input.dueDate, input.priority ?? "medium", input.estimateMinutes ?? null, input.memo ?? "", input.archived ? 1 : 0, now, now, input.status === "done" ? now : null);
  return getTask(Number(lastInsertRowid), db)!;
}

/**
 * UPDATE 文の SET に使う、完了日時の式。`:status` は更新後のステータス、`:now` は更新の時刻。
 * 完了以外にするなら NULL、すでに完了なら今の値のまま、完了にするなら `:now`。
 * 更新前の行のステータスを UPDATE 文の中で見るので、読んでから書くまでに別の更新が入ってもずれない。
 */
export const COMPLETED_AT_SQL =
  "completed_at = CASE WHEN :status <> 'done' THEN NULL WHEN status = 'done' THEN completed_at ELSE :now END";

/**
 * 更新の後の更新日時。今の時刻が前の更新日時より後でなければ（同じミリ秒に続けて更新したときなど）、前の値の 1 ミリ秒後にする。
 * 更新するたびに値が必ず変わるので、古い更新日時を付けた確認つきの更新（`updateTaskIfUnchanged`）が一致しない。
 */
export function nextUpdatedAt(previous: string, now: Date = new Date()): string {
  const prev = Date.parse(previous);
  if (Number.isNaN(prev) || now.getTime() > prev) return now.toISOString();
  return new Date(prev + 1).toISOString();
}

const UPDATE_TASK_SQL = `UPDATE tasks SET title = :title, status = :status, assignee = :assignee, due_date = :dueDate, priority = :priority, estimate_minutes = :estimateMinutes, memo = :memo, archived = :archived, updated_at = :now, ${COMPLETED_AT_SQL} WHERE id = :id`;

/** 今のタスクに変更を重ねて書き込む。`onlyIfUpdatedAt` を渡すと、更新日時がその値のときだけ書き込む。書き込んだら true。 */
function writeTask(current: Task, changes: Partial<TaskInput>, db: Db, onlyIfUpdatedAt?: string): boolean {
  const next = { ...current, ...changes };
  const params = {
    title: next.title,
    status: next.status,
    assignee: next.assignee,
    dueDate: next.dueDate,
    priority: next.priority,
    estimateMinutes: next.estimateMinutes,
    memo: next.memo,
    archived: next.archived ? 1 : 0,
    now: nextUpdatedAt(current.updatedAt),
    id: current.id,
  };
  const { changes: rows } =
    onlyIfUpdatedAt === undefined
      ? db.prepare(UPDATE_TASK_SQL).run(params)
      : db.prepare(`${UPDATE_TASK_SQL} AND updated_at = :expectedUpdatedAt`).run({ ...params, expectedUpdatedAt: onlyIfUpdatedAt });
  return Number(rows) > 0;
}

/** 指定した項目だけを更新する。タスクが無ければ undefined。完了日時はステータスの変化に合わせて決まる。 */
export function updateTask(id: number, changes: Partial<TaskInput>, db: Db = getDb()): Task | undefined {
  const current = getTask(id, db);
  if (!current) return undefined;
  writeTask(current, changes, db);
  return getTask(id, db);
}

export type CheckedUpdateResult =
  | { ok: true; task: Task }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; task: Task };

/**
 * 編集を始めたときの更新日時 `expectedUpdatedAt`（`toISOString()` の形）が今の更新日時と同じときだけ更新する（楽観的ロック）。
 * 違えば変更せずに conflict と最新のタスクを返す。確認と書き込みは 1 つの UPDATE 文の条件で行うので、
 * 読んでから書くまでにほかの更新が入っても、それを上書きせずに conflict になる。
 */
export function updateTaskIfUnchanged(
  id: number,
  changes: Partial<TaskInput>,
  expectedUpdatedAt: string,
  db: Db = getDb(),
): CheckedUpdateResult {
  const current = getTask(id, db);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.updatedAt === expectedUpdatedAt && writeTask(current, changes, db, expectedUpdatedAt)) {
    return { ok: true, task: getTask(id, db)! };
  }
  const latest = getTask(id, db);
  return latest ? { ok: false, reason: "conflict", task: latest } : { ok: false, reason: "not_found" };
}

/**
 * タスクを複製する。タイトル・担当者・期限・優先度・見積もり時間・タグを写し、ステータスは常に todo。
 * コメントと延長申請は写さない。元のタスクが無ければ undefined。
 */
export function duplicateTask(id: number, db: Db = getDb()): Task | undefined {
  const source = getTask(id, db);
  if (!source) return undefined;
  // 複製とタグの写しは 1 つのトランザクションで行い、どちらかだけが残らないようにする。
  return transaction(db, () => {
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
  });
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

export type DeleteTaskResult = "deleted" | "not_found" | "forbidden";

/**
 * タスクを消す（物理削除）。消せるのはタスクの担当者だけ。担当者のいないタスク（担当者が空）は、だれも消せない。
 * 完了済み・アーカイブ済みでも、担当者なら消せる。コメント・タグ・延長の申請は、外部キー（ON DELETE CASCADE）で一緒に消える。
 * 担当者の確認と削除は 1 つの DELETE 文の条件で行うので、確認の後に担当者が変わっても、担当者でない人は消せない。
 */
export function deleteTask(id: number, userId: string, db: Db = getDb()): DeleteTaskResult {
  return transaction(db, () => {
    const { changes } = db.prepare("DELETE FROM tasks WHERE id = ? AND assignee = ? AND assignee <> ''").run(id, userId);
    if (Number(changes) > 0) return "deleted";
    return getTask(id, db) ? "forbidden" : "not_found";
  });
}
