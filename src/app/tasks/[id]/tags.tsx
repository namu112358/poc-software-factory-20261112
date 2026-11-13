"use client";
// タグの追加フォームと外すボタン。操作のあと、サーバー側の一覧を読み直す。
// 追加でログインが切れていたら（401）、入力を残したまま、ログインし直す案内を出す（#491）。
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { readFormFailure } from "@/lib/session-expired";
import { TAG_MAX_LENGTH, formatTagLimitHint } from "@/lib/tag-limits";
import { SessionExpiredNotice } from "../../session-expired";

export function TagForm({ taskId, suggestions = [] }: { taskId: number; suggestions?: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    setPending(true);
    setError(undefined);
    setExpired(false);
    try {
      const res = await fetch(`/api/tasks/${taskId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const failure = readFormFailure(res.status, await res.json().catch(() => undefined), "タグを追加できませんでした。");
        if (failure.expired) setExpired(true);
        else setError(failure.messages.join(" "));
        return;
      }
      form.reset();
      router.refresh();
    } catch {
      setError("タグを追加できませんでした。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label="タグの追加" onSubmit={onSubmit}>
      <p>
        <input name="name" aria-label="タグの名前" maxLength={TAG_MAX_LENGTH} list={`tag-suggestions-${taskId}`} aria-describedby={`tag-limit-${taskId}`} />
        <span id={`tag-limit-${taskId}`}> {formatTagLimitHint()}</span>
        <datalist id={`tag-suggestions-${taskId}`}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </p>
      {error && <p role="alert">{error}</p>}
      {expired && (
        <p role="alert" data-testid="tag-session-expired">
          <SessionExpiredNotice />
        </p>
      )}
      <button type="submit" disabled={pending}>
        追加する
      </button>
    </form>
  );
}

export function RemoveTagButton({ taskId, name }: { taskId: number; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function onClick() {
    setError(undefined);
    try {
      const res = await fetch(`/api/tasks/${taskId}/tags/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) {
        setError("タグを外せませんでした。");
        return;
      }
      router.refresh();
    } catch {
      setError("タグを外せませんでした。");
    }
  }

  return (
    <>
      <button type="button" aria-label={`タグ「${name}」を外す`} onClick={onClick}>
        外す
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
