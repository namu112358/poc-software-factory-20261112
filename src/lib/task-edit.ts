// タスク詳細画面の編集フォームの処理。通信を引数で受け取り、画面に依らずに確かめられるようにする。
// 保存は PATCH /api/tasks/:id に、フォームを開いたときの更新日時（expectedUpdatedAt）を付けて送る。
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  isTaskPriority,
  isTaskStatus,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "./task-types.ts";

export type TaskEditValues = {
  title: string;
  status: TaskStatus;
  assignee: string;
  dueDate: string;
  priority: TaskPriority;
  memo: string;
};

export const TASK_EDIT_CONFLICT_MESSAGE = "ほかの人が先に更新しました。相手が変えた項目を下に並べます。";
export const TASK_EDIT_FAILED_MESSAGE = "タスクを保存できませんでした。";
export const TASK_EDIT_NOT_FOUND_MESSAGE = "タスクが見つかりません。削除された可能性があります。";

export type SaveTaskEditResult =
  | { status: "saved"; task: Task }
  | { status: "invalid"; messages: string[] }
  | { status: "conflict"; message: string; task: Task }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

type Deps = {
  fetch: (
    url: string,
    init: { method: "PATCH"; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
};

/** フォームに入れる値。今のタスクから取り出す。 */
export function taskToEditValues(task: Task): TaskEditValues {
  return {
    title: task.title,
    status: task.status,
    assignee: task.assignee,
    dueDate: task.dueDate,
    priority: task.priority,
    memo: task.memo,
  };
}

/** フォームの値を、PATCH /api/tasks/:id に送る本文にする（検証は API 側の `validateTaskInput` が行う）。 */
export function buildTaskEditBody(values: TaskEditValues, expectedUpdatedAt: string): Record<string, string> {
  return { ...values, expectedUpdatedAt };
}

/** 応答のタスクが、フォームを入れ直せる形か。 */
function isTaskLike(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "number" &&
    typeof t.title === "string" &&
    isTaskStatus(t.status) &&
    typeof t.assignee === "string" &&
    typeof t.dueDate === "string" &&
    isTaskPriority(t.priority) &&
    typeof t.memo === "string" &&
    typeof t.updatedAt === "string"
  );
}

/** API のエラー応答（`{ error, details? }`）から、フォームに並べる理由を取り出す。 */
function errorMessages(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [TASK_EDIT_FAILED_MESSAGE];
  const { error, details } = body as { error?: unknown; details?: unknown };
  const list = Array.isArray(details) ? details.filter((d): d is string => typeof d === "string") : [];
  if (list.length > 0) return list;
  return [typeof error === "string" && error !== "" ? error : TASK_EDIT_FAILED_MESSAGE];
}

/** 編集した内容を保存する。ほかの人が先に更新していたら（409）、上書きせずに最新のタスクを返す。 */
export async function saveTaskEdit(
  taskId: number,
  values: TaskEditValues,
  expectedUpdatedAt: string,
  deps: Deps,
): Promise<SaveTaskEditResult> {
  let res: Awaited<ReturnType<Deps["fetch"]>>;
  let body: unknown;
  try {
    res = await deps.fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildTaskEditBody(values, expectedUpdatedAt)),
    });
    body = await res.json().catch(() => undefined);
  } catch {
    return { status: "error", message: TASK_EDIT_FAILED_MESSAGE };
  }
  const task = (body as { task?: unknown } | undefined)?.task;
  if (res.ok) {
    return isTaskLike(task) ? { status: "saved", task } : { status: "error", message: TASK_EDIT_FAILED_MESSAGE };
  }
  if (res.status === 401) return { status: "unauthorized" };
  if (res.status === 404) return { status: "error", message: TASK_EDIT_NOT_FOUND_MESSAGE };
  if (res.status === 409) {
    return isTaskLike(task)
      ? { status: "conflict", message: TASK_EDIT_CONFLICT_MESSAGE, task }
      : { status: "error", message: TASK_EDIT_FAILED_MESSAGE };
  }
  if (res.status === 400) return { status: "invalid", messages: errorMessages(body) };
  return { status: "error", message: errorMessages(body)[0] };
}

/**
 * フォームを開くときに使うタスク。画面が持っている値と、このフォームで最後に受け取った値（保存・409 の応答）のうち、
 * 更新日時が新しいほうを使う（保存の直後、画面の読み直しが終わる前に開いても、古い更新日時で送らないため）。
 */
export function newerTask(shown: Task, received: Task | undefined): Task {
  if (!received || received.id !== shown.id) return shown;
  return Date.parse(received.updatedAt) > Date.parse(shown.updatedAt) ? received : shown;
}

export const TASK_EDIT_FIELD_LABELS: Record<keyof TaskEditValues, string> = {
  title: "タイトル",
  status: "ステータス",
  assignee: "担当者",
  dueDate: "期限",
  priority: "優先度",
  memo: "メモ",
};

const TASK_EDIT_FIELDS = Object.keys(TASK_EDIT_FIELD_LABELS) as (keyof TaskEditValues)[];

export const TASK_EDIT_NO_CHANGED_FIELDS_MESSAGE = "フォームの項目は変わっていません（タグなど、ほかの内容が変わりました）。";

/** 衝突の表の 1 行。値は画面に出す形（ラベル・名前）にしてある。 */
export type ConflictRow = { field: keyof TaskEditValues; label: string; base: string; current: string; mine: string };

/** 値を画面に出す形にする。期限の空欄は「なし」、担当者は名前（一覧に無ければ ID）。 */
export function formatEditValue<K extends keyof TaskEditValues>(
  field: K,
  value: TaskEditValues[K],
  userNames: ReadonlyMap<string, string>,
): string {
  switch (field) {
    case "status":
      return STATUS_LABELS[value as TaskStatus];
    case "priority":
      return PRIORITY_LABELS[value as TaskPriority];
    case "assignee":
      return userNames.get(value) ?? value;
    case "dueDate":
      return value === "" ? "なし" : value;
    default:
      return value;
  }
}

/**
 * 相手が変えた項目。編集を始めたときの値（base）と今の値（current）が違う項目だけを、項目の並び順で返す。
 * 自分の入力（mine）は判定に使わない（相手と同じ値に変えていても、相手が変えた項目として出す）。
 */
export function changedFields(base: TaskEditValues, current: TaskEditValues): (keyof TaskEditValues)[] {
  return TASK_EDIT_FIELDS.filter((f) => base[f] !== current[f]);
}

/** 衝突の表の行。相手が変えた項目ごとに「編集を始めたときの値」「今の値」「あなたの入力」を並べる。 */
export function conflictRows(
  base: TaskEditValues,
  current: TaskEditValues,
  mine: TaskEditValues,
  userNames: ReadonlyMap<string, string>,
): ConflictRow[] {
  return changedFields(base, current).map((field) => ({
    field,
    label: TASK_EDIT_FIELD_LABELS[field],
    base: formatEditValue(field, base[field], userNames),
    current: formatEditValue(field, current[field], userNames),
    mine: formatEditValue(field, mine[field], userNames),
  }));
}

/** 編集の状態。衝突の後は、今のタスク（conflict）を持ち、「今の値で編集し直す」まで保存できない。 */
export type TaskEditState = {
  taskId: number;
  values: TaskEditValues;
  base: TaskEditValues;
  expectedUpdatedAt: string;
  conflict?: Task;
};

/** 編集を始める。フォームの値と、編集を始めたときの値を、このタスクにする。 */
export function startTaskEdit(task: Task): TaskEditState {
  const values = taskToEditValues(task);
  return { taskId: task.id, values, base: values, expectedUpdatedAt: task.updatedAt };
}

/**
 * 保存が衝突した。フォームの入力・編集を始めたときの値・送る更新日時はそのままにし、今のタスクを覚える。
 * 別のタスクの応答なら比べずに、状態を変えない。
 */
export function recordConflict(state: TaskEditState, current: Task): TaskEditState {
  return current.id === state.taskId ? { ...state, conflict: current } : state;
}

/** 「今の値で編集し直す」。フォームの値・編集を始めたときの値・送る更新日時を、今のタスクのものにする。 */
export function rebaseOnCurrent(state: TaskEditState): TaskEditState {
  return state.conflict ? startTaskEdit(state.conflict) : state;
}

/** 保存できるか。衝突の表が出ている間は、自分の入力のまま送り直させない。 */
export function canSaveTaskEdit(state: TaskEditState): boolean {
  return state.conflict === undefined;
}
