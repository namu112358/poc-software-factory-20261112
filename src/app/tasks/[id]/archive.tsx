"use client";
// 「アーカイブする」「アーカイブを戻す」ボタン。切り替えられたら画面を読み込み直す。失敗したときは表示を変えずにエラーを出す。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setTaskArchived } from "@/lib/archive-toggle";

export function ArchiveButton({ taskId, archived, updatedAt }: { taskId: number; archived: boolean; updatedAt: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setError(undefined);
    setPending(true);
    const result = await setTaskArchived(taskId, !archived, updatedAt, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    if (result.status === "error") setError(result.message);
    else router.refresh();
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} data-testid="archive-toggle">
        {archived ? "アーカイブを戻す" : "アーカイブする"}
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
