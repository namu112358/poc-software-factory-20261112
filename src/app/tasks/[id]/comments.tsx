"use client";
// コメントの投稿フォーム・編集・削除・元に戻すボタン。操作のあと、サーバー側の一覧を読み直す。
// 投稿・編集でログインが切れていたら（401）、本文を残したまま、ログインし直す案内を出す（#491）。
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { confirmAndDeleteComment, requestRestoreComment } from "@/lib/comment-delete";
import { readFormFailure } from "@/lib/session-expired";
import { SessionExpiredNotice } from "../../session-expired";

export function CommentForm({ taskId }: { taskId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form).get("body");
    setPending(true);
    setError(undefined);
    setExpired(false);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const failure = readFormFailure(res.status, await res.json().catch(() => undefined), "コメントを投稿できませんでした。");
        if (failure.expired) setExpired(true);
        else setError(failure.messages.join(" "));
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
      {expired && (
        <p role="alert" data-testid="comment-session-expired">
          <SessionExpiredNotice />
        </p>
      )}
      <button type="submit" disabled={pending}>
        投稿する
      </button>
    </form>
  );
}

export function DeleteCommentButton({ taskId, commentId, body }: { taskId: number; commentId: number; body: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function onClick() {
    setError(undefined);
    const result = await confirmAndDeleteComment(taskId, commentId, body, {
      confirm: (message) => window.confirm(message),
      fetch: (url, init) => fetch(url, init),
    });
    if (result.status === "error") setError(result.message);
    else if (result.status === "deleted") router.refresh();
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
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get("body");
    setPending(true);
    setError(undefined);
    setExpired(false);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const failure = readFormFailure(res.status, await res.json().catch(() => undefined), "コメントを編集できませんでした。");
        if (failure.expired) setExpired(true);
        else setError(failure.messages.join(" "));
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
      {expired && (
        <p role="alert" data-testid="comment-edit-session-expired">
          <SessionExpiredNotice />
        </p>
      )}
      <button type="submit" disabled={pending}>
        保存する
      </button>{" "}
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(undefined);
          setExpired(false);
        }}
      >
        やめる
      </button>
    </form>
  );
}

export function RestoreCommentButton({ taskId, commentId }: { taskId: number; commentId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    setError(undefined);
    const result = await requestRestoreComment(taskId, commentId, (url, init) => fetch(url, init));
    setPending(false);
    if (result.status === "error") setError(result.message);
    else router.refresh();
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending}>
        元に戻す
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
