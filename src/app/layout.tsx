import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "PoC タスク管理" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="ja">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 24 }}>
        {user && (
          <header style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <a href="/tasks">タスク一覧</a>
            <span data-testid="header-user">{user.name}（{user.id}）</span>
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
