import { formatPageTitle } from "@/lib/page-title";
import { listBoard } from "@/lib/board";
import { VISIBLE_TASK_LIMIT, boardMoreHref, splitVisible } from "@/lib/task-overflow";
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
          {rows.map((row) => {
            const { shown, hiddenCount } = splitVisible(row.tasks, VISIBLE_TASK_LIMIT);
            return (
            <tr key={row.status} data-testid="board-row">
              <td>{row.label}</td>
              <td data-testid="board-count">{row.count}</td>
              <td>
                {row.tasks.length === 0 ? (
                  "なし"
                ) : (
                  <ul>
                    {shown.map((t) => (
                      <li key={t.id}>
                        <a href={`/tasks/${t.id}`} title={t.title}>{t.shortTitle}</a>
                      </li>
                    ))}
                  </ul>
                )}
                {hiddenCount > 0 && (
                  <a href={boardMoreHref(row.status)} data-testid="board-more">
                    ほか {hiddenCount} 件
                  </a>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
