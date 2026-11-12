import { requireUser } from "@/lib/session";
import { STATUS_LABELS, TASK_STATUSES, formatDaysLeft, isTaskStatus, listTasks, todayInJapan } from "@/lib/tasks";

type Props = {
  searchParams: Promise<{ status?: string }>;
};

export default async function TasksPage({ searchParams }: Props) {
  await requireUser();
  const params = await searchParams;
  const status = isTaskStatus(params.status) ? params.status : undefined;
  const tasks = listTasks({ status });
  const today = todayInJapan();

  return (
    <main>
      <h1>タスク一覧</h1>
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
        <button type="submit">絞り込む</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>タイトル</th>
            <th>ステータス</th>
            <th>担当者</th>
            <th>期限</th>
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
              <td>
                {task.dueDate}
                {formatDaysLeft(task, today) && (
                  <>
                    {" "}
                    <span data-testid="days-left">{formatDaysLeft(task, today)}</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.length === 0 && <p>該当するタスクはありません。</p>}
    </main>
  );
}
