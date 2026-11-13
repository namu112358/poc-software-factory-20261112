"use client";
// ほかの端末で新しくログインがあったときの知らせ（#478）。「確かめた」を押すか、ログイン中の端末の画面を開くと消える。
// ログイン中の端末の画面では、開いた時点で確かめた扱いになるので出さない。
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { acknowledgeLoginNotice } from "@/lib/login-notice-ack";

const SESSIONS_PATH = "/settings/sessions";

export function LoginNoticeBanner({ throughId, lines }: { throughId: number; lines: string[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (hidden || pathname === SESSIONS_PATH) return null;

  async function onClick() {
    setError(undefined);
    setPending(true);
    const result = await acknowledgeLoginNotice(throughId, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setHidden(true);
    router.refresh();
  }

  return (
    <div
      role="status"
      data-testid="login-notice"
      style={{
        margin: "0 0 16px",
        padding: "8px 12px",
        border: "1px solid #b91c1c",
        borderRadius: 4,
        background: "#fef2f2",
        color: "#7f1d1d",
      }}
    >
      {lines.map((line) => (
        <p key={line} style={{ margin: "0 0 4px" }}>
          {line}
        </p>
      ))}
      <p style={{ margin: "4px 0 0", display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center" }}>
        <span>身に覚えが無ければ、その端末を切り、パスワードを変えてください。</span>
        <a href={SESSIONS_PATH}>ログイン中の端末を見る</a>
        <button type="button" onClick={onClick} disabled={pending} data-testid="login-notice-ack">
          確かめた
        </button>
        {error && <span role="alert">{error}</span>}
      </p>
    </div>
  );
}
