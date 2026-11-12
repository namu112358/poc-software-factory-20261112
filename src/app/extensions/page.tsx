import { formatExtensionRequestedAt, listPendingExtensions } from "@/lib/extensions";
import { requireUser } from "@/lib/session";

export default async function ExtensionsPage() {
  await requireUser();
  const rows = listPendingExtensions();

  return (
    <main>
      <h1>承認待ちの期限延長</h1>
      {rows.length === 0 ? (
        <p data-testid="extensions-empty">承認待ちの申請はありません</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>タスク</th>
              <th>申請者</th>
              <th>今の期限</th>
              <th>希望の期限</th>
              <th>理由</th>
              <th>申請日時</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="extension-row">
                <td>
                  <a href={`/tasks/${r.taskId}`}>{r.taskTitle}</a>
                </td>
                <td>{r.requesterName}</td>
                <td>{r.currentDueDate}</td>
                <td>{r.newDueDate}</td>
                <td>{r.reason}</td>
                <td>{formatExtensionRequestedAt(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
