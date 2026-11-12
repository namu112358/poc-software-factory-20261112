import type { ReactNode } from "react";
import { formatFailedLoginNotice, formatPreviousLogin } from "@/lib/auth";
import { getCurrentFailedLoginsBefore, getCurrentPreviousLogin, getCurrentUser } from "@/lib/session";

export const metadata = { title: "PoC タスク管理" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const previousLogin = user ? await getCurrentPreviousLogin() : undefined;
  const failedLoginNotice = user ? formatFailedLoginNotice(await getCurrentFailedLoginsBefore()) : undefined;
  return (
    <html lang="ja">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 24 }}>
        {user && (
          <header style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <a href="/tasks">タスク一覧</a>
            <a href="/tasks/new">新しいタスク</a>
            <a href="/overdue">期限切れ</a>
            <a href="/tags">タグ一覧</a>
            <a href="/members">メンバー</a>
            <a href="/board">ステータス別</a>
            <a href="/extensions">承認待ちの延長</a>
            <a href="/tasks/deleted">削除したタスク</a>
            <a href="/settings/password">パスワード変更</a>
            <a href="/settings/sessions">ログイン中の端末</a>
            <a href="/settings/absence">休みの登録</a>
            <span data-testid="header-user">{user.name}（{user.id}）</span>
            <span data-testid="previous-login">{formatPreviousLogin(previousLogin ?? null)}</span>
            <form method="post" action="/api/logout">
              <button type="submit">ログアウト</button>
            </form>
            <form method="post" action="/api/logout-all">
              <button type="submit">すべての端末からログアウト</button>
            </form>
          </header>
        )}
        {user && failedLoginNotice && (
          <p
            role="status"
            data-testid="failed-login-notice"
            style={{
              margin: "0 0 16px",
              padding: "8px 12px",
              border: "1px solid #d97706",
              borderRadius: 4,
              background: "#fffbeb",
              color: "#78350f",
            }}
          >
            {failedLoginNotice}
          </p>
        )}
        {children}
      </body>
    </html>
  );
}
