import { formatPageTitle } from "@/lib/page-title";
import { taskRowAnchorId } from "@/lib/task-list-anchor";
import { Fragment } from "react";
import { bulkSelectionKey } from "@/lib/bulk-select";
import { listCommentersByTask } from "@/lib/comments";
import { NOTHING_TO_DO_TEXT, countMyDueTasks, limitItems, listExtensionsAwaitingMe, listMyDueTasks, listSuspendedBacklog, myDueTasksHref } from "@/lib/my-attention";
import { memberTasksHref } from "@/lib/member-suspension";
import { listAssigneeOptions, listSuspendedUserIds, withSuspendedMark } from "@/lib/members";
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

// 狭い画面（600px 未満）では、表の 1 行を「題名の段」と「ステータス・担当者・期限・優先度の段」に積む。
// 表の意味づけ（table・th）は残し、読み上げで列名が伝わるよう role も付ける。広い画面の表は変えない。
const TASK_LIST_CSS = `@media (max-width:599px){
.task-list,.task-list thead,.task-list tbody{display:block}
.task-list thead tr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.task-list tbody tr{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px;padding:6px 0 6px 32px;border-bottom:1px solid #ddd}
.task-list td{display:block;padding:0}
.task-list td.c-select{flex:0 0 20px;margin-left:-32px;margin-right:-12px;align-self:center;line-height:0}
.task-list td.c-select input{display:block}
.task-list td.c-title{flex:1 1 calc(100% - 44px);min-width:0;overflow-wrap:anywhere}
.task-list td.c-tags{flex:1 0 100%}
.task-list td.c-tags:empty,.task-list td.c-created,.task-list td.c-estimate,.task-list td.c-commenters{display:none}
.task-list td.c-status,.task-list td.c-assignee,.task-list td.c-due,.task-list td.c-priority{font-size:.875rem}
.task-list td.c-status::before,.task-list td.c-assignee::before,.task-list td.c-due::before,.task-list td.c-priority::before{content:attr(data-label) "：";color:#595959}
}`;

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
  const suspendedBacklog = listSuspendedBacklog(user.id);
  const suspendedIds = listSuspendedUserIds();
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
        {myTasks.length === 0 && myExtensions.length === 0 && suspendedBacklog.length === 0 && <p data-testid="my-attention-empty">{NOTHING_TO_DO_TEXT}</p>}
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
        {suspendedBacklog.length > 0 && (
          <>
            <h3>ログインを停止したメンバーの担当のタスク</h3>
            <ul>
              {suspendedBacklog.map((b) => (
                <li key={b.id} data-testid="suspended-backlog">
                  <a href={memberTasksHref(b.id)}>{b.name}さん</a>が担当のまま、未完了のタスクが {b.count} 件残っています
                </li>
              ))}
            </ul>
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
      <style>{TASK_LIST_CSS}</style>
      <table className="task-list" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader">選択</th>
            <th role="columnheader">タイトル</th>
            <th role="columnheader">ステータス</th>
            <th role="columnheader">担当者</th>
            <th role="columnheader">優先度</th>
            <th role="columnheader">期限</th>
            <th role="columnheader">作成日</th>
            <th role="columnheader">見積もり</th>
            <th role="columnheader">タグ</th>
            <th role="columnheader">コメントした人</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {tasks.map((task) => (
            <tr
              key={task.id}
              id={taskRowAnchorId(task.id)}
              data-testid="task-row"
              role="row"
              style={{ scrollMarginTop: 16, ...(task.status === "done" ? { color: "#8a8a8a" } : {}) }}
              {...taskRowDoneAttr(task.status)}
            >
              <td role="cell" className="c-select">
                <BulkCheckbox id={task.id} title={task.title} />
              </td>
              <td role="cell" className="c-title">
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
              <td role="cell" className="c-status" data-label="ステータス">{STATUS_LABELS[task.status]}</td>
              <td role="cell" className="c-assignee" data-label="担当者" data-testid="task-assignee">{withSuspendedMark(assigneeName(task.assignee, assignees), suspendedIds.has(task.assignee))}</td>
              <td role="cell" className="c-priority" data-label="優先度" data-testid="task-priority" style={{ fontWeight: priorityFontWeight(task.priority) }}>{PRIORITY_LABELS[task.priority]}</td>
              <td role="cell" className="c-due" data-label="期限">
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
              <td role="cell" className="c-created" data-testid="created-at">{formatJstDate(task.createdAt)}</td>
              <td role="cell" className="c-estimate" data-testid="task-estimate">{formatEstimate(task.estimateMinutes)}</td>
              <td role="cell" className="c-tags">
                {(tagsByTask.get(task.id) ?? []).map((name, i) => (
                  <Fragment key={name}>
                    {i > 0 && "、"}
                    <a href={`/tasks?tag=${encodeURIComponent(name)}`} data-testid="task-tag">
                      {name}
                    </a>
                  </Fragment>
                ))}
              </td>
              <td role="cell" className="c-commenters" data-testid="commenters">{(commentersByTask.get(task.id) ?? []).join("、")}</td>
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
