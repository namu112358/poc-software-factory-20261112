"use client";
// 「複製する」ボタン。複製できたら、新しいタスクの詳細画面に移る。
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DuplicateButton({ taskId }: { taskId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/tasks/${taskId}/duplicate`, { method: "POST" });
      if (!res.ok) {
        setError("タスクを複製できませんでした。");
        return;
      }
      const data = (await res.json()) as { task: { id: number } };
      router.push(`/tasks/${data.task.id}`);
    } catch {
      setError("タスクを複製できませんでした。");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending}>
        複製する
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
