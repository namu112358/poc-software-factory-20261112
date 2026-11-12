"use client";
// 「元に戻す」ボタン。戻せたら画面を読み直し、一覧から消す。断られたらその理由を出す。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestRestoreTask } from "@/lib/task-delete";

export function RestoreTaskButton({ taskId, title }: { taskId: number; title: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setError(undefined);
    setPending(true);
    const result = await requestRestoreTask(taskId, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    if (result.status === "error") setError(result.message);
    else router.refresh();
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} aria-label={`「${title}」を元に戻す`}>
        元に戻す
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
