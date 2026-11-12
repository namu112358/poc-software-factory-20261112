import { formatMonthDay } from "@/lib/absence";
import { listMemberWorkload } from "@/lib/members";
import { requireUser } from "@/lib/session";

export default async function MembersPage() {
  await requireUser();
  const members = listMemberWorkload();

  return (
    <main>
      <h1>メンバー一覧</h1>
      <table>
        <thead>
          <tr>
            <th>名前</th>
            <th>休み</th>
            <th>未完了のタスク数</th>
            <th>未完了のタスク</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} data-testid="member-row">
              <td>{m.name}</td>
              <td data-testid="member-leave">{m.leaveUntil ? `休み中（${formatMonthDay(m.leaveUntil)} まで）` : "—"}</td>
              <td data-testid="member-open-count">{m.openCount}</td>
              <td>
                {m.tasks.length === 0 ? (
                  "なし"
                ) : (
                  <ul>
                    {m.tasks.map((t) => (
                      <li key={t.id}>
                        <a href={`/tasks/${t.id}`}>{t.label}</a>
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
