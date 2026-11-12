import { Fragment } from "react";
import { requireUser } from "@/lib/session";
import { listTagsByTask } from "@/lib/tags";
import { PRIORITY_LABELS, STATUS_LABELS, SORT_LABELS, TASK_SORTS, TASK_STATUSES, formatEstimate, formatTaskCount, isOverdue, isTaskStatus, listAssignees, listTasks, parseAssignee, parseSort, parseTagFilter, todayInJapan } from "@/lib/tasks";

type Props = {
  searchParams: Promise<{ status?: string; assignee?: string; tag?: string; sort?: string }>;
};

export default async function TasksPage({ searchParams }: Props) {
  await requireUser();
  const params = await searchParams;
  const status = isTaskStatus(params.status) ? params.status : undefined;
  const assignee = parseAssignee(params.assignee);
  const tag = parseTagFilter(params.tag);
  const sort = parseSort(params.sort);
  const assignees = listAssignees();
  const tasks = listTasks({ status, assignee, tag, sort });
  const today = todayInJapan();
  const tagsByTask = listTagsByTask(tasks.map((t) => t.id));

  return (
    <main>
      <h1>タスク一覧</h1>
      {tag !== undefined && (
        <p>
          <span data-testid="tag-filter">タグ「{tag}」のタスク</span> <a href="/tasks">すべてのタスク</a>
        </p>
      )}
      <form method="get" aria-label="絞り込み">
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
      <table>
        <thead>
          <tr>
            <th>タイトル</th>
            <th>ステータス</th>
            <th>担当者</th>
            <th>優先度</th>
            <th>期限</th>
            <th>見積もり</th>
            <th>タグ</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} data-testid="task-row">
              <td>
                <a href={`/tasks/${task.id}`}>{task.title}</a>
              </td>
              <td>{STATUS_LABELS[task.status]}</td>
              <td>{task.assignee}</td>
              <td data-testid="task-priority">{PRIORITY_LABELS[task.priority]}</td>
              <td>
                {task.dueDate}
                {isOverdue(task, today) && (
                  <>
                    {" "}
                    <strong data-testid="overdue">期限切れ</strong>
                  </>
                )}
              </td>
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
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.length === 0 && <p>該当するタスクはありません。</p>}
    </main>
  );
}
