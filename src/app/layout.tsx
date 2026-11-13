import type { ReactNode } from "react";
import { APP_TITLE } from "@/lib/page-title";
import { HEADER_NAV_LINKS } from "@/lib/nav";
import { formatFailedLoginNotice, formatPreviousLogin } from "@/lib/auth";
import { getCurrentFailedLoginsBefore, getCurrentPreviousLogin, getCurrentUser } from "@/lib/session";

export const metadata = { title: `PoC ${APP_TITLE}` };

// 「本文へ移動」は、フォーカスが当たったときだけ見せる。
const SKIP_LINK_CSS = `.skip-link{position:absolute;left:-9999px;top:0}.skip-link:focus{position:static;display:inline-block;margin-bottom:8px}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const previousLogin = user ? await getCurrentPreviousLogin() : undefined;
  const failedLoginNotice = user ? formatFailedLoginNotice(await getCurrentFailedLoginsBefore()) : undefined;
  return (
    <html lang="ja">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 24 }}>
        {user && (
          <>
            <style>{SKIP_LINK_CSS}</style>
            <a className="skip-link" href="#main-content">
              本文へ移動
            </a>
          </>
        )}
        {user && (
          <header style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center", marginBottom: 16 }}>
            <nav aria-label="メインメニュー" style={{ display: "contents" }}>
              {HEADER_NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} style={{ whiteSpace: "nowrap" }}>
                  {link.label}
                </a>
              ))}
            </nav>
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
