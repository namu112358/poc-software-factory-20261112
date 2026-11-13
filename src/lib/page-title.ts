import { formatTaskNumber } from "./task-format.ts";

export const APP_TITLE = "タスク管理";

/** ページのタイトル。画面の名前（`h1` と同じ）に、アプリ名を続ける。 */
export function formatPageTitle(screenName: string): string {
  const name = screenName.trim();
  return name === "" ? APP_TITLE : `${name} - ${APP_TITLE}`;
}

/** ログインしていない人に見せるタスクの詳細のタイトル。タスクの有無や名前を含めない。 */
export const TASK_DETAIL_FALLBACK_TITLE = formatPageTitle("タスクの詳細");

/**
 * タスクの詳細のタイトル。ログインしていなければタスクを読まずに固定のタイトルを返す
 * （メタデータはページ本体のログイン確認より前に作られ、リダイレクトの応答にも入るため）。
 */
export function formatTaskDetailTitle(
  loggedIn: boolean,
  findTask: () => { id: number; title: string } | undefined,
): string {
  if (!loggedIn) return TASK_DETAIL_FALLBACK_TITLE;
  const task = findTask();
  return formatPageTitle(task ? `${task.title} ${formatTaskNumber(task.id)}` : "タスクが見つかりません");
}
