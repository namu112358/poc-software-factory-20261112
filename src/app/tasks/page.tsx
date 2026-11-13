import { formatPageTitle } from "@/lib/page-title";
import { Fragment } from "react";
import { bulkSelectionKey } from "@/lib/bulk-select";
import { listCommentersByTask } from "@/lib/comments";
import { NOTHING_TO_DO_TEXT, countMyDueTasks, limitItems, listExtensionsAwaitingMe, listMyDueTasks, myDueTasksHref } from "@/lib/my-attention";
import { listAssigneeOptions } from "@/lib/members";
import { BulkBar, BulkCheckbox, BulkSelection } from "./BulkActions";
import { buildAssigneeFilterOptions, buildCheckboxOptions } from "@/lib/task-filter-form";
import { exportHref } from "@/lib/export";
import { parseIncludeArchived } from "@/lib/task-query";
import { RESET_TASK_VIEW_HREF, resolveTaskViewQuery } from "@/lib/task-view-prefs";
import { getCurrentLoginWindow, requireUser } from "@/lib/session";
import { NEWLY_ASSIGNED_HEADING, listNewlyAssignedTasks, newlyAssignedNames } from "@/lib/assignee-history";
import { formatJstDateTime } from "@/lib/task-format";
import { listTagCounts, listTagsByTask } from "@/lib/tags";
import { DUE_FILTER_LABELS, TASK_DUE_FILTERS, parseDueFilter, assigneeName, PRIORITY_LABELS, STATUS_LABELS, SORT_LABELS, TASK_LIST_HELP, TASK_SORTS, TASK_STATUSES, formatCurrentUser, clearFilterHref, formatEstimate, formatJstDate, formatDaysLeft, formatEstimateTotal, countUnestimated, formatUnestimatedCount, formatMemoPreview, formatTaskCount, formatDoneCount, priorityFontWeight, formatOverdueCount, countOverdue, memoTooltip, isOverdue, isTaskStatus, listAssignees, listTasks, parseAssignees, parseKeyword, parseSort, parseTagFilters, sumEstimateMinutes, taskRowDoneAttr, todayInJapan } from "@/lib/tasks";

type Props = {
  searchParams: Promise<{ status?: string; assignee?: string | string[]; tag?: string | string[]; q?: string; due?: string; sort?: string; archived?: string; reset?: string }>;
};

export const metadata = { title: formatPageTitle("タスク一覧") };

export default async function TasksPage({ searchParams }: Props) {
  const user = await requireUser();
  const rawParams = await searchParams;
  const params = resolveTaskViewQuery(user.id, rawParams, rawParams.reset === "1") as typeof rawParams;
  const status = isTaskStatus(params.status) ? params.status : undefined;
  const selectedAssignees = parseAssignees(params.assignee);
  const tags = parseTagFilters(params.tag);
  const allTags = listTagCounts();
  const q = parseKeyword(params.q);
  const due = parseDueFilter(params.due);
  const sort = parseSort(params.sort);
  const includeArchived = parseIncludeArchived(params.archived);
  const assignees = listAssignees();
  const tasks = listTasks({ status, assignees: selectedAssignees, tags, q, qInComments: true, due, sort, includeArchived });
  const today = todayInJapan();
  const clearHref = clearFilterHref(tasks.length);
  const unestimatedText = formatUnestimatedCount(countUnestimated(tasks));
  const overdueText = formatOverdueCount(countOverdue(tasks, today));
  const tagsByTask = listTagsByTask(tasks.map((t) => t.id));
  const commentersByTask = listCommentersByTask(tasks.map((t) => t.id));
  const users = listAssigneeOptions();
  const myTasks = listMyDueTasks(user.id, undefined, today);
  const myExtensions = listExtensionsAwaitingMe(user.id);
  const myTasksView = limitItems(myTasks);
  const myExtensionsView = limitItems(myExtensions);
  const myCounts = countMyDueTasks(myTasks);
  const loginWindow = await getCurrentLoginWindow();
  const newlyAssigned = listNewlyAssignedTasks(user.id, loginWindow?.previousLoginAt, loginWindow?.loginAt);
  const selectionKey = bulkSelectionKey({ status, assignees: selectedAssignees, tags, q, due, sort, includeArchived });

  return (
    <main id="main-content" tabIndex={-1}>
      <h1>タスク一覧</h1>
      <p data-testid="current-user">{formatCurrentUser(user.name)}</p>
      <p data-testid="list-help">{TASK_LIST_HELP}</p>
      {newlyAssigned.length > 0 && (
        <section aria-labelledby="newly-assigned-heading" data-testid="newly-assigned">
          <h2 id="newly-assigned-heading">{NEWLY_ASSIGNED_HEADING(newlyAssigned.length)}</h2>
          <ul>
            {newlyAssigned.map((n) => {
              const names = newlyAssignedNames(n);
              return (
                <li key={n.taskId} data-testid="newly-assigned-task">
                  <a href={`/tasks/${n.taskId}`}>{n.title}</a>（前の担当者: {names.from}、替えた人: {names.by}、{formatJstDateTime(n.changedAt)}）
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section aria-labelledby="my-attention-heading" data-testid="my-attention">
        <h2 id="my-attention-heading">あなたの対応が必要なもの</h2>
        {myTasks.length === 0 && myExtensions.length === 0 && <p data-testid="my-attention-empty">{NOTHING_TO_DO_TEXT}</p>}
        {myTasks.length > 0 && (
          <>
            <h3>担当のタスク（期限切れ・期限間近）</h3>
            <p data-testid="my-task-total">全部で {myTasks.length} 件（期限切れ {myCounts.overdue} 件・期限間近 {myCounts.dueSoon} 件）</p>
            <ul>
              {myTasksView.shown.map((t) => (
                <li key={t.id} data-testid="my-task">
                  <strong>{t.kind === "overdue" ? "期限切れ" : "期限間近"}</strong> <a href={`/tasks/${t.id}`}>{t.title}</a>（期限 {t.dueDate}）
                </li>
              ))}
            </ul>
            {myTasksView.hidden > 0 && (
              <p>
                <a href={myDueTasksHref(user.id)} data-testid="my-task-more">
                  ほか {myTasksView.hidden} 件
                </a>
              </p>
            )}
          </>
        )}
        {myExtensions.length > 0 && (
          <>
            <h3>承認待ちの期限延長</h3>
            <p data-testid="my-extension-total">全部で {myExtensions.length} 件</p>
            <ul>
              {myExtensionsView.shown.map((e) => (
                <li key={e.id} data-testid="my-extension">
                  <a href="/extensions">{e.taskTitle}</a>（{e.requesterName}さんの申請: {e.currentDueDate} → {e.newDueDate}）
                </li>
              ))}
            </ul>
            {myExtensionsView.hidden > 0 && (
              <p>
                <a href="/extensions" data-testid="my-extension-more">
                  ほか {myExtensionsView.hidden} 件
                </a>
              </p>
            )}
          </>
        )}
      </section>
      <p>
        <a href="/tasks/new" data-testid="new-task-link">
          新しいタスク
        </a>
      </p>
      {tags.length > 0 && (
        <p>
          <span data-testid="tag-filter">{tags.map((t) => `タグ「${t}」`).join("・")}{tags.length > 1 ? "がすべて付いた" : "の"}タスク</span> <a href={RESET_TASK_VIEW_HREF}>すべてのタスク</a>
        </p>
      )}
      <form method="get" aria-label="絞り込み">
        <label>
          キーワード{" "}
          <input type="search" name="q" defaultValue={q ?? ""} maxLength={100} placeholder="タイトル・メモ・コメント" />
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
        <fieldset data-testid="assignee-filter">
          <legend>担当者（選んだだれかが担当のタスクが出ます）</legend>
          {buildAssigneeFilterOptions(selectedAssignees).map((o) => (
            <label key={o.value}>
              <input type="checkbox" name="assignee" value={o.value} defaultChecked={o.checked} /> {o.label}{" "}
            </label>
          ))}
        </fieldset>{" "}
        <label>
          期限{" "}
          <select name="due" defaultValue={due ?? ""} data-testid="due-filter">
            <option value="">指定なし</option>
            {TASK_DUE_FILTERS.map((d) => (
              <option key={d} value={d}>
                {DUE_FILTER_LABELS[d]}
              </option>
            ))}
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
        <label>
          <input type="checkbox" name="archived" value="include" defaultChecked={includeArchived} data-testid="include-archived" /> アーカイブ済みも表示
        </label>{" "}
        {allTags.length > 0 && (
          <>
            <fieldset data-testid="tag-filter-options">
              <legend>タグ（5 つまで・すべてが付いたタスクだけ）</legend>
              {buildCheckboxOptions(allTags.map((t) => ({ value: t.name, label: t.name })), tags).map((o) => (
                <label key={o.value}>
                  <input type="checkbox" name="tag" value={o.value} defaultChecked={o.checked} /> {o.label}{" "}
                </label>
              ))}
            </fieldset>{" "}
          </>
        )}
        <button type="submit">絞り込む</button>{" "}
        <a href={RESET_TASK_VIEW_HREF} data-testid="reset-view">
          条件をすべて解除
        </a>
      </form>
      <p data-testid="task-count">{formatTaskCount(tasks.length)}</p>
      <p>
        <a href={exportHref({ status, assignees: selectedAssignees, tags, q, due, sort })} data-testid="export-link">
          CSV でダウンロード
        </a>
      </p>
      {overdueText !== null && (
        <p>
          <strong data-testid="overdue-count">{overdueText}</strong>
        </p>
      )}
      <BulkSelection key={selectionKey} visibleIds={tasks.map((t) => t.id)}>
      <BulkBar users={users} />
      <table>
        <thead>
          <tr>
            <th>選択</th>
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
                <BulkCheckbox id={task.id} title={task.title} />
              </td>
              <td>
                <a href={`/tasks/${task.id}`} title={memoTooltip(task.memo)} style={task.status === "done" ? { color: "inherit" } : undefined}>
                  {task.title}
                </a>
                {task.archived && (
                  <>
                    {" "}
                    <small data-testid="archived-label">アーカイブ済み</small>
                  </>
                )}
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
      </BulkSelection>
      <p data-testid="estimate-total">見積もりの合計: {formatEstimateTotal(sumEstimateMinutes(tasks))}
        {unestimatedText !== null && (
          <>
            {" "}
            <span data-testid="unestimated-count">{unestimatedText}</span>
          </>
        )}
      </p>
      <p data-testid="done-count">{formatDoneCount(tasks)}</p>
      {tasks.length === 0 && (
        <p>
          該当するタスクはありません。
          {clearHref !== null && (
            <>
              {" "}
              <a href={clearHref} data-testid="clear-filter">
                絞り込みを解除する
              </a>
            </>
          )}
        </p>
      )}
    </main>
  );
}
