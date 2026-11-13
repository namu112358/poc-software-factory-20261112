"use client";
// メンバーの一覧の「取りまとめる人にする」「メンバーに戻す」ボタン（#524）。確かめてから替え、替えられたら画面を読み込み直す。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { roleButtonLabel, roleConfirmMessage, setMemberRole } from "@/lib/member-role";
import type { UserRole } from "@/lib/user-role";

export function RoleButton({ memberId, name, to, self }: { memberId: string; name: string; to: UserRole; self: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (!window.confirm(roleConfirmMessage(name, to, self))) return;
    setError(undefined);
    setPending(true);
    const result = await setMemberRole(memberId, to, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    if (result.status === "error") setError(result.message);
    else router.refresh();
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} data-testid="member-role-toggle">
        {roleButtonLabel(to)}
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
