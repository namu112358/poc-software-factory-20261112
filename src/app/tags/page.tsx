import { listTagCounts } from "@/lib/tags";
import { requireUser } from "@/lib/session";

export default async function TagsPage() {
  await requireUser();
  const tags = listTagCounts();

  return (
    <main>
      <h1>タグ一覧</h1>
      {tags.length === 0 ? (
        <p data-testid="tags-empty">タグはまだありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>タグ</th>
              <th>タスクの件数</th>
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
