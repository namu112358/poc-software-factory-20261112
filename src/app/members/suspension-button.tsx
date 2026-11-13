"use client";
// メンバーの一覧の「ログインを停止」「ログインを再開」ボタン（#522）。停止は確かめてから行う。切り替えられたら画面を読み込み直す。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setMemberSuspended, suspendConfirmMessage } from "@/lib/member-suspension";

export function SuspensionButton({ memberId, name, suspended }: { memberId: string; name: string; suspended: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (!suspended && !window.confirm(suspendConfirmMessage(name))) return;
    setError(undefined);
    setPending(true);
    const result = await setMemberSuspended(memberId, !suspended, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    if (result.status === "error") setError(result.message);
    else router.refresh();
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} data-testid="member-suspension-toggle">
        {suspended ? "ログインを再開" : "ログインを停止"}
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
