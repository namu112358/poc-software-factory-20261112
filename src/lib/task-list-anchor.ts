/** タスク一覧の行につける目印（URL の `#` 以降で、その行へ移動するために使う）。 */
export function taskRowAnchorId(taskId: number): string {
  return `task-row-${taskId}`;
}

/** 詳細の「← タスク一覧へ戻る」の行き先。絞り込みは覚えた条件から戻り、開いていたタスクの行へ移動する。 */
export function backToTaskListHref(taskId: number): string {
  return `/tasks#${taskRowAnchorId(taskId)}`;
}
