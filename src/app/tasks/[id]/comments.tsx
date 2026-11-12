"use client";
// コメントの投稿フォームと削除ボタン。操作のあと、サーバー側の一覧を読み直す。
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function CommentForm({ taskId }: { taskId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form).get("body");
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
        setError(data.details?.join(" ") ?? data.error ?? "コメントを投稿できませんでした。");
        return;
      }
      form.reset();
      router.refresh();
    } catch {
      setError("コメントを投稿できませんでした。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label="コメント" onSubmit={onSubmit}>
      <p>
        <textarea name="body" rows={3} cols={50} aria-label="コメントの本文" />
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={pending}>
        投稿する
      </button>
    </form>
  );
}

export function DeleteCommentButton({ taskId, commentId }: { taskId: number; commentId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function onClick() {
    setError(undefined);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" });
      if (!res.ok) {
        setError("コメントを削除できませんでした。");
        return;
      }
      router.refresh();
    } catch {
      setError("コメントを削除できませんでした。");
    }
  }

  return (
    <>
      <button type="button" onClick={onClick}>
        削除
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}

export function EditCommentForm({ taskId, commentId, body }: { taskId: number; commentId: number; body: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get("body");
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
        setError(data.details?.join(" ") ?? data.error ?? "コメントを編集できませんでした。");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("コメントを編集できませんでした。");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        編集
      </button>
    );
  }

  return (
    <form aria-label="コメントの編集" onSubmit={onSubmit}>
      <p>
        <textarea name="body" rows={3} cols={50} aria-label="編集する本文" defaultValue={body} />
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={pending}>
        保存する
      </button>{" "}
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(undefined);
        }}
      >
        やめる
      </button>
    </form>
  );
}
