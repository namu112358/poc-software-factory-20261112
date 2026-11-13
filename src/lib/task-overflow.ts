/** ボードとメンバーの一覧の 1 つの欄に、題名を出すタスクの数。これを超えた分は「ほか N 件」にまとめる。 */
export const VISIBLE_TASK_LIMIT = 5;

/** 先頭の `limit` 件と、出さない件数。件数が `limit` 以下なら、出さない件数は 0。 */
export function splitVisible<T>(items: T[], limit: number = VISIBLE_TASK_LIMIT): { shown: T[]; hiddenCount: number } {
  return { shown: items.slice(0, limit), hiddenCount: Math.max(0, items.length - limit) };
}

/** ボードの欄の「ほか N 件」のリンク先。そのステータスで絞り込んだタスク一覧。 */
export function boardMoreHref(status: string): string {
  return `/tasks?${new URLSearchParams({ status }).toString()}`;
}

/** メンバーの欄の「ほか N 件」のリンク先。その人が担当のタスク一覧（一覧には完了を除く絞り込みが無いので、完了も出る）。 */
export function memberMoreHref(userId: string): string {
  return `/tasks?${new URLSearchParams({ assignee: userId }).toString()}`;
}
