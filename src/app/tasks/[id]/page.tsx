import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { STATUS_LABELS, getTask, parseTaskId } from "@/lib/tasks";
import { getUser } from "@/lib/users";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TaskDetailPage({ params }: Props) {
  await requireUser();
  const id = parseTaskId((await params).id);
  const task = id === undefined ? undefined : getTask(id);
  if (!task) notFound();
  const assignee = getUser(task.assignee);

  return (
    <main>
      <p>
        <a href="/tasks">← タスク一覧へ戻る</a>
      </p>
      <h1 data-testid="task-title">{task.title}</h1>
      <dl>
        <dt>ステータス</dt>
        <dd data-testid="task-status">{STATUS_LABELS[task.status]}</dd>
        <dt>担当者</dt>
        <dd data-testid="task-assignee">{assignee?.name ?? task.assignee}</dd>
        <dt>期限</dt>
        <dd data-testid="task-due-date">{task.dueDate}</dd>
      </dl>
    </main>
  );
}
