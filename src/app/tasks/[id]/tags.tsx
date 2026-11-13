"use client";
// タグの追加フォームと外すボタン。操作のあと、サーバー側の一覧を読み直す。
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TAG_MAX_LENGTH, formatTagLimitHint } from "@/lib/tag-limits";

export function TagForm({ taskId, suggestions = [] }: { taskId: number; suggestions?: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/tasks/${taskId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
        setError(data.details?.join(" ") ?? data.error ?? "タグを追加できませんでした。");
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
