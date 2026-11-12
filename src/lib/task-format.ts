import type { Assignee, Task, TaskPriority, TaskStatus } from "./task-types.ts";

/** 一覧に出す担当者の名前。担当者の一覧に無い ID（通常は起きない）は ID のまま、担当者なしは空文字。 */
export function assigneeName(assignee: string | null | undefined, assignees: Assignee[]): string {
  if (!assignee) return "";
  return assignees.find((a) => a.id === assignee)?.name ?? assignee;
}

export const TASK_LIST_HELP = "ステータス・担当者・タグで絞り込み、優先度の高い順に並べ替えられます。";

export function formatTaskCount(count: number): string {
  return `${count} 件`;
}

/** 一覧の見出しの下に出す、ログイン中のユーザーの表示。ログイン ID ではなく表示名を使う。 */
export function formatCurrentUser(name: string): string {
  return `ログイン中: ${name}`;
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

/** 見積もりが未設定（null）のタスクの数。 */
export function countUnestimated(tasks: { estimateMinutes: number | null }[]): number {
  return tasks.filter((t) => t.estimateMinutes === null).length;
}

/** 見積もり未設定の件数の表示用の文字列（例: （見積もり未設定 3 件））。0 件は null（表示しない）。 */
export function formatUnestimatedCount(count: number): string | null {
  return count > 0 ? `（見積もり未設定 ${count} 件）` : null;
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

/** 詳細画面の「完了」欄の表示。完了済みで完了日時が記録されているときだけ日時を返し、それ以外は「—」。 */
export function formatCompletedAt(task: Pick<Task, "status" | "completedAt">): string {
  if (task.status !== "done" || task.completedAt === null) return "—";
  return formatJstDateTime(task.completedAt);
}

/** ISO 8601（UTC）の日時を、日本時間の日付「YYYY-MM-DD」にする。解釈できなければ「—」。 */
export function formatJstDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
