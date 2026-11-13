import { formatPageTitle } from "@/lib/page-title";
import { listBoard } from "@/lib/board";
import { requireUser } from "@/lib/session";

export const metadata = { title: formatPageTitle("ステータス別のタスク") };

export default async function BoardPage() {
  await requireUser();
  const rows = listBoard();

  return (
    <main id="main-content" tabIndex={-1}>
      <h1>ステータス別のタスク</h1>
      <table>
        <thead>
          <tr>
            <th>ステータス</th>
            <th>件数</th>
            <th>タスク</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.status} data-testid="board-row">
              <td>{row.label}</td>
              <td data-testid="board-count">{row.count}</td>
              <td>
                {row.tasks.length === 0 ? (
                  "なし"
                ) : (
                  <ul>
                    {row.tasks.map((t) => (
                      <li key={t.id}>
                        <a href={`/tasks/${t.id}`}>{t.shortTitle}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
