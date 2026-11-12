"use client";
// 「削除する」ボタン。確認のダイアログで OK したときだけ消し、消えたらタスク一覧へ戻る。キャンセルなら何も送らない。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmAndDeleteTask } from "@/lib/task-delete";

export function DeleteTaskButton({ taskId, title }: { taskId: number; title: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setError(undefined);
    setPending(true);
    const result = await confirmAndDeleteTask(taskId, title, {
      confirm: (message) => window.confirm(message),
      fetch: (url, init) => fetch(url, init),
    });
    setPending(false);
    if (result.status === "error") setError(result.message);
    if (result.status === "deleted") {
      router.push("/tasks");
      router.refresh();
    }
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending}>
        削除する
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
