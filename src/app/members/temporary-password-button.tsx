"use client";
// メンバーの一覧の「仮のパスワードを出し直す」ボタン（#566）。確かめてから出し直し、新しい仮のパスワードをこの場で 1 度だけ見せる。
// 一覧（「仮のパスワードのまま」の表示）は読み込み直す。仮のパスワードは画面を離れる・再読み込みすると二度と出ない。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { reissueConfirmMessage, reissuedNotice, requestTemporaryPassword } from "@/lib/member-temporary-password";

export function TemporaryPasswordButton({ memberId, name }: { memberId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string>();

  async function onClick() {
    if (!window.confirm(reissueConfirmMessage(name))) return;
    setError(undefined);
    setTemporaryPassword(undefined);
    setPending(true);
    const result = await requestTemporaryPassword(memberId, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setTemporaryPassword(result.temporaryPassword);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} data-testid="member-reissue-password">
        {pending ? "出し直し中…" : "仮のパスワードを出し直す"}
      </button>
      {error && <span role="alert"> {error}</span>}
      {temporaryPassword && (
        <span role="status" data-testid="member-reissued">
          {" "}
          仮のパスワード: <code data-testid="reissued-temporary-password">{temporaryPassword}</code> {reissuedNotice(name)}
        </span>
      )}
    </>
  );
}
