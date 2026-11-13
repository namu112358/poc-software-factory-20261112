import { getDb, savepoint, transaction, type Db } from "./db/index.ts";
import { addDays, RESTORE_DAYS, todayInJapan } from "./task-dates.ts";
import type { Assignee, Task, TaskFilter, TaskInput, TaskPriority, TaskStatus } from "./task-types.ts";

/** タスクに登場する担当者（重複なし）。 */
export function listAssignees(db: Db = getDb()): Assignee[] {
  return db
    .prepare(
      "SELECT DISTINCT u.id AS id, u.name AS name FROM tasks t JOIN users u ON u.id = t.assignee WHERE t.deleted_at IS NULL ORDER BY u.id",
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
      : filter.sort === "due"
        ? "ORDER BY CASE WHEN status = 'done' THEN 1 ELSE 0 END, due_date IS NULL, due_date, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id"
        : "ORDER BY id";
  const today = filter.today ?? todayInJapan();
  const rows = db
    .prepare(
      "SELECT id, title, status, assignee, due_date, priority, estimate_minutes, created_at, updated_at, completed_at, memo, archived FROM tasks WHERE deleted_at IS NULL AND (:includeArchived = 1 OR archived = 0) AND (:status IS NULL OR status = :status) AND (:assigneeCount = 0 OR (:assigneeNone = 1 AND assignee IS NULL) OR assignee IN (SELECT value FROM json_each(:assigneeIds))) AND (:tagCount = 0 OR (SELECT COUNT(DISTINCT g.name) FROM task_tags g WHERE g.task_id = tasks.id AND g.name IN (:tag0, :tag1, :tag2, :tag3, :tag4)) = :tagCount) AND (:due IS NULL OR (:due = 'none' AND (due_date IS NULL OR due_date = '')) OR (:due = 'overdue' AND due_date IS NOT NULL AND due_date <> '' AND due_date < :today) OR (:due = 'today' AND due_date IS NOT NULL AND due_date <> '' AND due_date <= :today) OR (:due = 'week' AND due_date IS NOT NULL AND due_date <> '' AND due_date <= :weekEnd)) AND (:q IS NULL OR title LIKE :q ESCAPE '\\' OR memo LIKE :q ESCAPE '\\' OR (:qInComments = 1 AND EXISTS (SELECT 1 FROM comments c WHERE c.task_id = tasks.id AND c.deleted_at IS NULL AND c.body LIKE :q ESCAPE '\\'))) " + orderBy,
    )
    .all({ status: filter.status ?? null, ...assigneeParams(filter), ...tagParams(filter), q: filter.q === undefined ? null : likePattern(filter.q), qInComments: filter.qInComments ? 1 : 0, includeArchived: filter.includeArchived ? 1 : 0, due: filter.due ?? null, today, weekEnd: addDays(today, 7) }) as TaskRow[];
  return rows.map(toTask);
}

/** キーワードを、含むかどうかの LIKE のパターンにする。`%`・`_`・`\` はその文字そのものとして扱う。 */
function likePattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, "\\$&")}%`;
}

export function getTask(id: number, db: Db = getDb()): Task | undefined {
  const row = db.prepare("SELECT id, title, status, assignee, due_date, priority, estimate_minutes, created_at, updated_at, completed_at, memo, archived FROM tasks WHERE id = ? AND deleted_at IS NULL").get(id) as
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

const UPDATE_TASK_SQL = `UPDATE tasks SET title = :title, status = :status, assignee = :assignee, due_date = :dueDate, priority = :priority, estimate_minutes = :estimateMinutes, memo = :memo, archived = :archived, updated_at = :now, ${COMPLETED_AT_SQL} WHERE id = :id AND deleted_at IS NULL`;

/**
 * 今のタスクに変更を重ねて書き込む。`onlyIfUpdatedAt` を渡すと、更新日時がその値のときだけ書き込む。書き込んだら true。
 * 担当者が変わったときは、担当者の変更の履歴を同じセーブポイントの中で 1 件足す（どちらかだけが残ることはない）。
 * 変更前の担当者は、書き込む直前に DB から読み直した値を使う（編集を始めたときの値ではない）。
 */
function writeTask(current: Task, changes: Partial<TaskInput>, db: Db, changedBy: string | null, onlyIfUpdatedAt?: string): boolean {
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
  return savepoint(db, () => {
    const update =
      onlyIfUpdatedAt === undefined
        ? db.prepare(UPDATE_TASK_SQL)
        : db.prepare(`${UPDATE_TASK_SQL} AND updated_at = :expectedUpdatedAt`);
    const before = db.prepare("SELECT assignee FROM tasks WHERE id = ?").get(current.id) as { assignee: string } | undefined;
    const { changes: rows } =
      onlyIfUpdatedAt === undefined ? update.run(params) : update.run({ ...params, expectedUpdatedAt: onlyIfUpdatedAt });
    if (Number(rows) === 0) return false;
    if (before && before.assignee !== params.assignee) {
      db.prepare(
        "INSERT INTO task_assignee_changes (task_id, from_assignee, to_assignee, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)",
      ).run(current.id, before.assignee, params.assignee, changedBy, params.now);
    }
    return true;
  });
}

/**
 * 指定した項目だけを更新する。タスクが無ければ undefined。完了日時はステータスの変化に合わせて決まる。
 * `changedBy` は更新した利用者の ID。担当者が変わったときに、担当者の変更の履歴に残す。
 */
export function updateTask(id: number, changes: Partial<TaskInput>, db: Db = getDb(), changedBy: string | null = null): Task | undefined {
  const current = getTask(id, db);
  if (!current) return undefined;
  writeTask(current, changes, db, changedBy);
  return getTask(id, db);
}

export type CheckedUpdateResult =
  | { ok: true; task: Task }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; task: Task };

/**
 * 編集を始めたときの更新日時 `expectedUpdatedAt`（`toISOString()` の形）が今の更新日時と同じときだけ更新する（楽観的ロック）。
 * 違えば変更せずに conflict と最新のタスクを返す。`changedBy` は `updateTask` と同じ。確認と書き込みは 1 つの UPDATE 文の条件で行うので、
 * 読んでから書くまでにほかの更新が入っても、それを上書きせずに conflict になる。
 */
export function updateTaskIfUnchanged(
  id: number,
  changes: Partial<TaskInput>,
  expectedUpdatedAt: string,
  db: Db = getDb(),
  changedBy: string | null = null,
): CheckedUpdateResult {
  const current = getTask(id, db);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.updatedAt === expectedUpdatedAt && writeTask(current, changes, db, changedBy, expectedUpdatedAt)) {
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
 * 完了にしたタスクの更新日時は、1 件ずつの更新と同じく、そのタスクの前回の更新日時より必ず後にする（`nextUpdatedAt`。`now` は今の時刻）。
 * 完了日時も同じ値にする。
 */
export function completeTasks(ids: readonly number[], db: Db = getDb(), now: Date = new Date()): BulkCompleteResult {
  return transaction(db, () => {
    const found = ids.map((id) => getTask(id, db));
    const missingIds = ids.filter((_, i) => found[i] === undefined);
    if (missingIds.length > 0) return { ok: false, missingIds };
    const update = db.prepare("UPDATE tasks SET status = 'done', updated_at = ?, completed_at = ? WHERE id = ? AND status <> 'done' AND deleted_at IS NULL");
    for (const task of found as Task[]) {
      if (task.status === "done") continue;
      const updatedAt = nextUpdatedAt(task.updatedAt, now);
      update.run(updatedAt, updatedAt, task.id);
    }
    return { ok: true, tasks: ids.map((id) => getTask(id, db)!) };
  });
}

export type DeleteTaskResult = "deleted" | "not_found" | "forbidden";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `now` の時点で元に戻せる削除済みのタスクの、削除した日時の下限（これより後に削除したものだけ戻せる）。ISO 8601（UTC）。 */
export function restoreCutoff(now: Date): string {
  return new Date(now.getTime() - RESTORE_DAYS * MS_PER_DAY).toISOString();
}

/** 削除したタスクを元に戻せる最後の時刻（削除した日時から RESTORE_DAYS 日後。この時刻になると戻せない）。ISO 8601（UTC）。 */
export function restoreDeadline(deletedAt: string): string {
  return new Date(Date.parse(deletedAt) + RESTORE_DAYS * MS_PER_DAY).toISOString();
}

/**
 * タスクを消す。行は残し、削除した日時と削除した人を記録して、一覧・API・集計から見えなくする（RESTORE_DAYS 日のあいだは `restoreTask` で戻せる）。
 * 消せるのはタスクの担当者だけ。担当者のいないタスク（担当者が空）は、だれも消せない。完了済み・アーカイブ済みでも、担当者なら消せる。
 * コメント・タグ・延長の申請・担当者の履歴は消さずに残す。削除済みのタスクをもう一度消そうとすると not_found。
 * 担当者の確認と記録は 1 つの UPDATE 文の条件で行うので、確認の後に担当者が変わっても、担当者でない人は消せない。
 */
export function deleteTask(id: number, userId: string, db: Db = getDb(), now: Date = new Date()): DeleteTaskResult {
  return transaction(db, () => {
    const { changes } = db
      .prepare("UPDATE tasks SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL AND assignee = ? AND assignee <> ''")
      .run(now.toISOString(), userId, id, userId);
    if (Number(changes) > 0) return "deleted";
    return getTask(id, db) ? "forbidden" : "not_found";
  });
}

export type DeletedTask = {
  id: number;
  title: string;
  assignee: string; // 担当者の ID（元に戻せるのはこの人だけ）
  assigneeName: string; // 担当者の表示名（見つからなければ ID、空なら「—」）
  deletedBy: string; // 削除した人の ID
  deletedByName: string; // 削除した人の表示名（見つからなければ ID）
  deletedAt: string; // ISO 8601（UTC）
  restoreDeadline: string; // 元に戻せる最後の時刻。ISO 8601（UTC）
};

/** `now` の時点で元に戻せる（削除してから RESTORE_DAYS 日たっていない）削除済みのタスク。削除した日時の新しい順（同じなら ID の大きい順）。 */
export function listDeletedTasks(db: Db = getDb(), now: Date = new Date()): DeletedTask[] {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.title AS title, t.assignee AS assignee, a.name AS assigneeName,
              t.deleted_by AS deletedBy, d.name AS deletedByName, t.deleted_at AS deletedAt
         FROM tasks t
         LEFT JOIN users a ON a.id = t.assignee
         LEFT JOIN users d ON d.id = t.deleted_by
        WHERE t.deleted_at IS NOT NULL AND t.deleted_at > ?
        ORDER BY t.deleted_at DESC, t.id DESC`,
    )
    .all(restoreCutoff(now)) as { id: number; title: string; assignee: string; assigneeName: string | null; deletedBy: string | null; deletedByName: string | null; deletedAt: string }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    assignee: r.assignee,
    assigneeName: r.assigneeName ?? (r.assignee === "" ? "—" : r.assignee),
    deletedBy: r.deletedBy ?? "",
    deletedByName: r.deletedByName ?? r.deletedBy ?? "—",
    deletedAt: r.deletedAt,
    restoreDeadline: restoreDeadline(r.deletedAt),
  }));
}

export type RestoreTaskResult = "restored" | "not_found" | "forbidden";

/**
 * 削除したタスクを元に戻す。戻せるのは、削除してから RESTORE_DAYS 日たっていないタスクの担当者だけ（担当者が空ならだれも戻せない）。
 * 削除していないタスク・期間を過ぎたタスク・存在しないタスクは not_found。戻したタスクは、更新日時などを含めて削除する前のまま。
 * 期間と担当者の確認と書き込みは 1 つの UPDATE 文の条件で行う。
 */
export function restoreTask(id: number, userId: string, db: Db = getDb(), now: Date = new Date()): RestoreTaskResult {
  return transaction(db, () => {
    const cutoff = restoreCutoff(now);
    const { changes } = db
      .prepare(
        "UPDATE tasks SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at > ? AND assignee = ? AND assignee <> ''",
      )
      .run(id, cutoff, userId);
    if (Number(changes) > 0) return "restored";
    const restorable = db.prepare("SELECT 1 FROM tasks WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at > ?").get(id, cutoff);
    return restorable ? "forbidden" : "not_found";
  });
}

/** 絞り込みのタグ（`tag` と `tags` を合わせ、重複を除いた先頭の 5 つ）を SQL のパラメータにする。付いていることを求めるタグの数が tagCount。 */
function tagParams(filter: { tag?: string; tags?: readonly string[] }): Record<string, string | number | null> {
  const names = [...new Set([...(filter.tag === undefined ? [] : [filter.tag]), ...(filter.tags ?? [])])].slice(0, 5);
  return { tagCount: names.length, tag0: names[0] ?? null, tag1: names[1] ?? null, tag2: names[2] ?? null, tag3: names[3] ?? null, tag4: names[4] ?? null };
}

/** 絞り込みの担当者（`assignee` と `assignees` を合わせ、重複を除いたもの）を SQL のパラメータにする。担当者なし（`none`）は別に持つ。 */
function assigneeParams(filter: { assignee?: string; assignees?: readonly string[] }): Record<string, string | number> {
  const ids = [...new Set([...(filter.assignee === undefined ? [] : [filter.assignee]), ...(filter.assignees ?? [])])];
  return { assigneeCount: ids.length, assigneeNone: ids.includes("none") ? 1 : 0, assigneeIds: JSON.stringify(ids.filter((id) => id !== "none")) };
}
