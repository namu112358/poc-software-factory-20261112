import { extensionStatusLabel, formatExtensionRequestedAt, listMyExtensions, listPendingExtensions } from "@/lib/extensions";
import { requireUser } from "@/lib/session";
import { PendingExtensionsTable } from "./extension-actions";

export default async function ExtensionsPage() {
  const user = await requireUser();
  const rows = listPendingExtensions().map((r) => ({
    id: r.id,
    taskId: r.taskId,
    taskTitle: r.taskTitle,
    requester: r.requester,
    requesterName: r.requesterName,
    currentDueDate: r.currentDueDate,
    newDueDate: r.newDueDate,
    reason: r.reason,
    requestedAt: formatExtensionRequestedAt(r.createdAt),
  }));

  const mine = listMyExtensions(user.id);

  return (
    <main>
      <h1>承認待ちの期限延長</h1>
      <PendingExtensionsTable rows={rows} userId={user.id} />
      <h2>自分が出した申請（直近 30 日）</h2>
      {mine.length === 0 ? (
        <p data-testid="my-extensions-empty">出した申請はありません</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>タスク</th>
              <th>希望の期限</th>
              <th>申請日時</th>
              <th>結果</th>
              <th>判断した人</th>
              <th>判断した日時</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((r) => (
              <tr key={r.id} data-testid="my-extension-row">
                <td>
                  <a href={`/tasks/${r.taskId}`}>{r.taskTitle}</a>
                </td>
                <td>{r.newDueDate}</td>
                <td>{formatExtensionRequestedAt(r.createdAt)}</td>
                <td data-testid="my-extension-status">{extensionStatusLabel(r.status)}</td>
                <td>{r.status === "pending" ? "—" : (r.decidedByName ?? "不明")}</td>
                <td>{r.status === "pending" ? "—" : r.decidedAt ? formatExtensionRequestedAt(r.decidedAt) : "不明"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
