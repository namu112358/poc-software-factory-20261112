import { formatTaskDetailTitle } from "@/lib/page-title";
import { notFound } from "next/navigation";
import { formatAssigneeChange, listAssigneeChanges } from "@/lib/assignee-history";
import { commentEditedLabel, listCommentRevisions, listComments, listDeletedComments, splitCommentBody } from "@/lib/comments";
import { commentPreview } from "@/lib/comment-delete";
import { getCurrentUser, requireUser } from "@/lib/session";
import { listTags, listTagSuggestions } from "@/lib/tags";
import { PRIORITY_LABELS, RESTORE_DAYS, STATUS_LABELS, formatCompletedAt, formatEstimate, formatJstDateTime, formatTaskNumber, getTask, isDueSoon, isOverdue, parseTaskId, todayInJapan } from "@/lib/tasks";
import { listAssigneeOptions } from "@/lib/members";
import { getUser } from "@/lib/users";
import { backToTaskListHref } from "@/lib/task-list-anchor";
import { ArchiveButton } from "./archive";
import { DeleteTaskButton } from "./delete";
import { DuplicateButton } from "./duplicate";
import { EditTaskForm } from "./edit-form";
import { CommentForm, DeleteCommentButton, EditCommentForm, RestoreCommentButton } from "./comments";
import { listExtensions } from "@/lib/extensions";
import { canRequestExtension, extensionResultLabel, findPendingExtension, pendingExtensionLabel, recentExtensionResults } from "@/lib/task-extension-panel";
import { ExtensionRequestForm } from "./extension-form";
import { RemoveTagButton, TagForm } from "./tags";

export async function generateMetadata({ params }: Props) {
  const user = await getCurrentUser();
  const id = parseTaskId((await params).id);
  return { title: formatTaskDetailTitle(user !== undefined, () => (id === undefined ? undefined : getTask(id))) };
}

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
  const deletedComments = listDeletedComments(task.id);
  const commentRevisions = listCommentRevisions(task.id);
  const tags = listTags(task.id);
  const tagSuggestions = listTagSuggestions(task.id);
  const assigneeChanges = listAssigneeChanges(task.id);
  const extensions = listExtensions(task.id);
  const pendingExtension = findPendingExtension(extensions);
  const extensionResults = recentExtensionResults(extensions);

  return (
    <main id="main-content" tabIndex={-1}>
      <p>
        <a href={backToTaskListHref(task.id)}>← タスク一覧へ戻る</a>
      </p>
      <h1>
        <span data-testid="task-title">{task.title}</span>{" "}
        <span data-testid="task-number" style={{ color: "#666", fontWeight: "normal" }}>
          {formatTaskNumber(task.id)}
        </span>
        {task.archived && (
          <>
            {" "}
            <span data-testid="archived-label" style={{ background: "#e5e5e5", padding: "0 0.4em", borderRadius: "3px", fontSize: "0.6em", fontWeight: "normal" }}>
              アーカイブ済み
            </span>
          </>
        )}
      </h1>
      <dl>
        <dt>ステータス</dt>
        <dd data-testid="task-status">{STATUS_LABELS[task.status]}</dd>
        <dt>担当者</dt>
        <dd data-testid="task-assignee">{assignee?.name ?? task.assignee}</dd>
        <dt>優先度</dt>
        <dd data-testid="task-priority">{PRIORITY_LABELS[task.priority]}</dd>
        <dt>期限</dt>
        <dd data-testid="task-due-date">
          {task.dueDate}
          {isOverdue(task, todayInJapan()) && (
            <>
              {" "}
              <strong data-testid="overdue" style={{ color: "#c00" }}>
                期限切れ
              </strong>
            </>
          )}
          {isDueSoon(task, todayInJapan()) && (
            <>
              {" "}
              <span data-testid="due-soon" style={{ background: "#fff3b0", padding: "0 0.4em", borderRadius: "3px" }}>
                期限が近い
              </span>
            </>
          )}
        </dd>
        <dt>見積もり時間</dt>
        <dd data-testid="task-estimate">{formatEstimate(task.estimateMinutes)}</dd>
        <dt>作成</dt>
        <dd data-testid="created-at">{formatJstDateTime(task.createdAt)}</dd>
        <dt>更新</dt>
        <dd data-testid="updated-at">{formatJstDateTime(task.updatedAt)}</dd>
        <dt>完了</dt>
        <dd data-testid="completed-at">{formatCompletedAt(task)}</dd>
      </dl>
      <EditTaskForm task={task} users={listAssigneeOptions()} />
      <p>
        <DuplicateButton taskId={task.id} /> <ArchiveButton taskId={task.id} archived={task.archived} updatedAt={task.updatedAt} />{" "}
        <DeleteTaskButton taskId={task.id} title={task.title} />
      </p>
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
        <h2>期限の延長</h2>
        {pendingExtension ? (
          <p data-testid="extension-pending">{pendingExtensionLabel(pendingExtension.newDueDate)}</p>
        ) : (
          canRequestExtension(task.assignee, user.id, extensions) && (
            <ExtensionRequestForm taskId={task.id} currentDueDate={task.dueDate} />
          )
        )}
        {extensionResults.length > 0 && (
          <ul>
            {extensionResults.map((e) => (
              <li key={e.id} data-testid="extension-result">
                {extensionResultLabel(e)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>担当者の履歴</h2>
        {assigneeChanges.length === 0 ? (
          <p>変更はありません</p>
        ) : (
          <ul>
            {assigneeChanges.map((c) => (
              <li key={c.id} data-testid="assignee-change">
                {formatAssigneeChange(c)}
              </li>
            ))}
          </ul>
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
        <TagForm taskId={task.id} suggestions={tagSuggestions} />
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
                  <strong>{c.authorName}</strong> <time dateTime={c.createdAt}>{formatJstDateTime(c.createdAt)}</time>
                  {commentEditedLabel(c)}
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {splitCommentBody(c.body).map((part, i) =>
                    part.type === "link" ? (
                      <a key={i} href={part.url} target="_blank" rel="noopener noreferrer">
                        {part.url}
                      </a>
                    ) : (
                      part.text
                    ),
                  )}
                </p>
                {(commentRevisions.get(c.id)?.length ?? 0) > 0 && (
                  <details data-testid="comment-revisions">
                    <summary>編集の前の本文（{commentRevisions.get(c.id)!.length} 件）</summary>
                    <ol>
                      {commentRevisions.get(c.id)!.map((r, i) => (
                        <li key={i} data-testid="comment-revision">
                          <time dateTime={r.editedAt}>{formatJstDateTime(r.editedAt)}</time> に編集する前
                          <p style={{ whiteSpace: "pre-wrap" }}>{r.body}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {c.author === user.id && (
                  <>
                    <EditCommentForm taskId={task.id} commentId={c.id} body={c.body} />{" "}
                    <DeleteCommentButton taskId={task.id} commentId={c.id} body={c.body} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <CommentForm taskId={task.id} />
        {deletedComments.length > 0 && (
          <section aria-labelledby="deleted-comments-heading">
            <h3 id="deleted-comments-heading">削除したコメント</h3>
            <p>削除してから {RESTORE_DAYS} 日のあいだは、書いた本人が元に戻せます。</p>
            <ul>
              {deletedComments.map((c) => (
                <li key={c.id} data-testid="deleted-comment">
                  「{commentPreview(c.body)}」 — {c.authorName}、<time dateTime={c.deletedAt}>{formatJstDateTime(c.deletedAt)}</time> に削除
                  {c.author === user.id && (
                    <>
                      {" "}
                      <RestoreCommentButton taskId={task.id} commentId={c.id} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  );
}
