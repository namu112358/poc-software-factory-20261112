// タスク作成画面（/tasks/new）の入力の組み立てと、API の応答から表示する理由の取り出し。
import type { TaskPriority, TaskStatus } from "./task-types.ts";

export const TASK_CREATE_FAILED_MESSAGE = "タスクを作成できませんでした";

export type TaskFormValues = {
  title: string;
  assignee: string;
  dueDate: string;
  status: TaskStatus;
  priority: TaskPriority;
  memo: string;
};

/** フォームの入力を、`POST /api/tasks` に送る本文にする（検証は API 側の `validateTaskInput` が行う）。 */
export function buildTaskBody(values: TaskFormValues): Record<string, string> {
  return {
    title: values.title,
    assignee: values.assignee,
    dueDate: values.dueDate,
    status: values.status,
    priority: values.priority,
    memo: values.memo,
  };
}

/** API のエラー応答（`{ error, details? }`）から、画面の上に並べる理由を取り出す。 */
export function taskFormErrorMessages(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [TASK_CREATE_FAILED_MESSAGE];
  const { error, details } = body as { error?: unknown; details?: unknown };
  const list = Array.isArray(details) ? details.filter((d): d is string => typeof d === "string") : [];
  if (list.length > 0) return list;
  return [typeof error === "string" && error !== "" ? error : TASK_CREATE_FAILED_MESSAGE];
}

/** 作成したタスクの詳細画面の URL。 */
export function taskDetailHref(id: number): string {
  return `/tasks/${id}`;
}
