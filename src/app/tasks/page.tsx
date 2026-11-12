import { Fragment } from "react";
import { listCommentersByTask } from "@/lib/comments";
import { exportHref } from "@/lib/export";
import { requireUser } from "@/lib/session";
import { listTagsByTask } from "@/lib/tags";
import { assigneeName, PRIORITY_LABELS, STATUS_LABELS, SORT_LABELS, TASK_LIST_HELP, TASK_SORTS, TASK_STATUSES, formatCurrentUser, formatEstimate, formatJstDate, formatDaysLeft, formatEstimateTotal, formatMemoPreview, formatTaskCount, priorityFontWeight, formatOverdueCount, countOverdue, memoTooltip, isOverdue, isTaskStatus, listAssignees, listTasks, parseAssignee, parseKeyword, parseSort, parseTagFilter, sumEstimateMinutes, taskRowDoneAttr, todayInJapan } from "@/lib/tasks";

type Props = {
  searchParams: Promise<{ status?: string; assignee?: string; tag?: string; q?: string; sort?: string }>;
};

export default async function TasksPage({ searchParams }: Props) {
  const user = await requireUser();
  const params = await searchParams;
  const status = isTaskStatus(params.status) ? params.status : undefined;
  const assignee = parseAssignee(params.assignee);
  const tag = parseTagFilter(params.tag);
  const q = parseKeyword(params.q);
  const sort = parseSort(params.sort);
  const assignees = listAssignees();
  const tasks = listTasks({ status, assignee, tag, q, sort });
  const today = todayInJapan();
  const overdueText = formatOverdueCount(countOverdue(tasks, today));
  const tagsByTask = listTagsByTask(tasks.map((t) => t.id));
  const commentersByTask = listCommentersByTask(tasks.map((t) => t.id));

  return (
    <main>
      <h1>タスク一覧</h1>
      <p data-testid="current-user">{formatCurrentUser(user.name)}</p>
      <p data-testid="list-help">{TASK_LIST_HELP}</p>
      {tag !== undefined && (
        <p>
          <span data-testid="tag-filter">タグ「{tag}」のタスク</span> <a href="/tasks">すべてのタスク</a>
        </p>
      )}
      <form method="get" aria-label="絞り込み">
        <label>
          キーワード{" "}
          <input type="search" name="q" defaultValue={q ?? ""} maxLength={100} placeholder="タイトル・メモ" />
        </label>{" "}
        <label>
          ステータス{" "}
          <select name="status" defaultValue={status ?? ""}>
            <option value="">すべて</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          担当者{" "}
          <select name="assignee" defaultValue={assignee ?? ""}>
            <option value="">すべて</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value="none">担当者なし</option>
          </select>
        </label>{" "}
        <label>
          並び順{" "}
          <select name="sort" defaultValue={sort}>
            {TASK_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>{" "}
        {tag !== undefined && <input type="hidden" name="tag" value={tag} />}
        <button type="submit">絞り込む</button>
      </form>
      <p data-testid="task-count">{formatTaskCount(tasks.length)}</p>
      <p>
        <a href={exportHref({ status, assignee, tag, q, sort })} data-testid="export-link">
          CSV でダウンロード
        </a>
      </p>
      {overdueText !== null && (
        <p>
          <strong data-testid="overdue-count">{overdueText}</strong>
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>タイトル</th>
            <th>ステータス</th>
            <th>担当者</th>
            <th>優先度</th>
            <th>期限</th>
            <th>作成日</th>
            <th>見積もり</th>
            <th>タグ</th>
            <th>コメントした人</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              data-testid="task-row"
              {...taskRowDoneAttr(task.status)}
              style={task.status === "done" ? { color: "#8a8a8a" } : undefined}
            >
              <td>
                <a href={`/tasks/${task.id}`} title={memoTooltip(task.memo)} style={task.status === "done" ? { color: "inherit" } : undefined}>
                  {task.title}
                </a>
                {formatMemoPreview(task.memo) !== null && (
                  <small data-testid="memo-preview" style={{ display: "block" }}>
                    {formatMemoPreview(task.memo)}
                  </small>
                )}
              </td>
              <td>{STATUS_LABELS[task.status]}</td>
              <td data-testid="task-assignee">{assigneeName(task.assignee, assignees)}</td>
              <td data-testid="task-priority" style={{ fontWeight: priorityFontWeight(task.priority) }}>{PRIORITY_LABELS[task.priority]}</td>
              <td>
                {task.dueDate}
                {isOverdue(task, today) && (
                  <>
                    {" "}
                    <strong data-testid="overdue">期限切れ</strong>
                  </>
                )}
                {formatDaysLeft(task, today) && (
                  <>
                    {" "}
                    <span data-testid="days-left">{formatDaysLeft(task, today)}</span>
                  </>
                )}
              </td>
              <td data-testid="created-at">{formatJstDate(task.createdAt)}</td>
              <td data-testid="task-estimate">{formatEstimate(task.estimateMinutes)}</td>
              <td>
                {(tagsByTask.get(task.id) ?? []).map((name, i) => (
                  <Fragment key={name}>
                    {i > 0 && "、"}
                    <a href={`/tasks?tag=${encodeURIComponent(name)}`} data-testid="task-tag">
                      {name}
                    </a>
                  </Fragment>
                ))}
              </td>
              <td data-testid="commenters">{(commentersByTask.get(task.id) ?? []).join("、")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p data-testid="estimate-total">見積もりの合計: {formatEstimateTotal(sumEstimateMinutes(tasks))}</p>
      {tasks.length === 0 && <p>該当するタスクはありません。</p>}
    </main>
  );
}
