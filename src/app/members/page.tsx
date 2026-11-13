import { formatPageTitle } from "@/lib/page-title";
import { formatMonthDay } from "@/lib/absence";
import { listMemberWorkload, sortMembersByOverdue } from "@/lib/members";
import { VISIBLE_TASK_LIMIT, memberMoreHref, splitVisible } from "@/lib/task-overflow";
import { requireUser } from "@/lib/session";

export const metadata = { title: formatPageTitle("メンバー一覧") };

export default async function MembersPage() {
  await requireUser();
  const members = sortMembersByOverdue(listMemberWorkload());

  return (
    <main id="main-content" tabIndex={-1}>
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
          {members.map((m) => {
            const { shown, hiddenCount } = splitVisible(m.tasks, VISIBLE_TASK_LIMIT);
            return (
            <tr key={m.id} data-testid="member-row" style={m.overdueCount > 0 ? { background: "#fdecea", fontWeight: "bold" } : undefined}>
              <td>
                {m.name}
                {m.overdueCount > 0 && (
                  <>
                    {" "}
                    <span data-testid="member-overdue-flag">期限切れあり（{m.overdueCount} 件）</span>
                  </>
                )}
              </td>
              <td data-testid="member-leave">{m.leaveUntil ? `休み中（${formatMonthDay(m.leaveUntil)} まで）` : "—"}</td>
              <td data-testid="member-open-count">{m.openCount}</td>
              <td>
                {m.tasks.length === 0 ? (
                  "なし"
                ) : (
                  <ul>
                    {shown.map((t) => (
                      <li key={t.id}>
                        <a href={`/tasks/${t.id}`} title={t.title}>{t.label}</a>
                      </li>
                    ))}
                  </ul>
                )}
                {hiddenCount > 0 && (
                  <>
                    <a href={memberMoreHref(m.id)} data-testid="member-more">
                      ほか {hiddenCount} 件
                    </a>
                    <small>（リンク先は、完了したタスクも含めた {m.name} さんの担当の一覧です）</small>
                  </>
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
