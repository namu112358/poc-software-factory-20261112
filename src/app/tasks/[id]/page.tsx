import { notFound } from "next/navigation";
import { listComments } from "@/lib/comments";
import { requireUser } from "@/lib/session";
import { listTags } from "@/lib/tags";
import { PRIORITY_LABELS, STATUS_LABELS, formatEstimate, formatJstDateTime, getTask, parseTaskId } from "@/lib/tasks";
import { getUser } from "@/lib/users";
import { CommentForm, DeleteCommentButton } from "./comments";
import { RemoveTagButton, TagForm } from "./tags";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TaskDetailPage({ params }: Props) {
  const user = await requireUser();
  const id = parseTaskId((await params).id);
  const task = id === undefined ? undefined : getTask(id);
  if (!task) notFound();
  const assignee = getUser(task.assignee);
  const comments = listComments(task.id);
  const tags = listTags(task.id);

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
        <dt>優先度</dt>
        <dd data-testid="task-priority">{PRIORITY_LABELS[task.priority]}</dd>
        <dt>期限</dt>
        <dd data-testid="task-due-date">{task.dueDate}</dd>
        <dt>見積もり時間</dt>
        <dd data-testid="task-estimate">{formatEstimate(task.estimateMinutes)}</dd>
        <dt>作成</dt>
        <dd data-testid="created-at">{formatJstDateTime(task.createdAt)}</dd>
        <dt>更新</dt>
        <dd data-testid="updated-at">{formatJstDateTime(task.updatedAt)}</dd>
      </dl>
      <section>
        <h2>メモ</h2>
        {task.memo === "" ? (
          <p>メモはありません。</p>
        ) : (
          <p data-testid="memo" style={{ whiteSpace: "pre-wrap" }}>
            {task.memo}
          </p>
        )}
      </section>
      <section>
        <h2>タグ</h2>
        {tags.length === 0 ? (
          <p>タグはまだありません。</p>
        ) : (
          <ul>
            {tags.map((name) => (
              <li key={name}>
                <span data-testid="tag">{name}</span> <RemoveTagButton taskId={task.id} name={name} />
              </li>
            ))}
          </ul>
        )}
        <TagForm taskId={task.id} />
      </section>
      <section>
        <h2>コメント</h2>
        {comments.length === 0 ? (
          <p>コメントはまだありません。</p>
        ) : (
          <ul>
            {comments.map((c) => (
              <li key={c.id} data-testid="comment">
                <p>
                  <strong>{c.authorName}</strong> <time dateTime={c.createdAt}>{c.createdAt}</time>
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p>
                {c.author === user.id && <DeleteCommentButton taskId={task.id} commentId={c.id} />}
              </li>
            ))}
          </ul>
        )}
        <CommentForm taskId={task.id} />
      </section>
    </main>
  );
}
