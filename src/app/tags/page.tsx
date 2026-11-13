import { formatPageTitle } from "@/lib/page-title";
import { listTagCounts } from "@/lib/tags";
import { requireUser } from "@/lib/session";

export const metadata = { title: formatPageTitle("タグ一覧") };

export default async function TagsPage() {
  await requireUser();
  const tags = listTagCounts();

  return (
    <main id="main-content" tabIndex={-1}>
      <h1>タグ一覧</h1>
      {tags.length === 0 ? (
        <p data-testid="tags-empty">タグはまだありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>タグ</th>
              <th>タスク数</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((t) => (
              <tr key={t.name} data-testid="tag-row">
                <td>
                  <a href={`/tasks?tag=${encodeURIComponent(t.name)}`}>{t.name}</a>
                </td>
                <td data-testid="tag-count">{t.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
