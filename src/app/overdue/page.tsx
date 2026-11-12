import { listOverdueTasks } from "@/lib/overdue";
import { requireUser } from "@/lib/session";

export default async function OverduePage() {
  await requireUser();
  const rows = listOverdueTasks();

  return (
    <main>
      <h1>期限切れのタスク</h1>
      {rows.length === 0 ? (
        <p>期限を過ぎたタスクはありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>題名</th>
              <th>担当者</th>
              <th>期限</th>
              <th>超過</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="overdue-row">
                <td>
                  <a href={`/tasks/${r.id}`}>{r.title}</a>
                </td>
                <td>{r.assigneeName}</td>
                <td>{r.dueDate}</td>
                <td>{r.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
