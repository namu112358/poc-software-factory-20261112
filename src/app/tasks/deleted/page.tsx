import { formatPageTitle } from "@/lib/page-title";
import { requireUser } from "@/lib/session";
import { RESTORE_DAYS, formatJstDateTime, listDeletedTasks } from "@/lib/tasks";
import { RestoreTaskButton } from "./restore";

export const metadata = { title: formatPageTitle("削除したタスク") };

export default async function DeletedTasksPage() {
  const user = await requireUser();
  const rows = listDeletedTasks();

  return (
    <main id="main-content" tabIndex={-1}>
      <h1>削除したタスク</h1>
      <p>削除してから {RESTORE_DAYS} 日のあいだは、担当者が元に戻せます。元に戻すと、コメント・タグ・延長の申請・担当者の履歴も元どおりに見えます。</p>
      {rows.length === 0 ? (
        <p>元に戻せる削除したタスクはありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>題名</th>
              <th>担当者</th>
              <th>削除した人</th>
              <th>削除した日時</th>
              <th>元に戻せる期限</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="deleted-task-row">
                <td>{r.title}</td>
                <td>{r.assigneeName}</td>
                <td>{r.deletedByName}</td>
                <td>{formatJstDateTime(r.deletedAt)}</td>
                <td>{formatJstDateTime(r.restoreDeadline)} まで</td>
                <td>{r.assignee !== "" && r.assignee === user.id ? <RestoreTaskButton taskId={r.id} title={r.title} /> : "担当者だけが元に戻せます"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
