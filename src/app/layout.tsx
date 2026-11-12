import type { ReactNode } from "react";
import { formatPreviousLogin } from "@/lib/auth";
import { getCurrentPreviousLogin, getCurrentUser } from "@/lib/session";

export const metadata = { title: "PoC タスク管理" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const previousLogin = user ? await getCurrentPreviousLogin() : undefined;
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
            <a href="/settings/password">パスワード変更</a>
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
        {children}
      </body>
    </html>
  );
}
