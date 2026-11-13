"use client";
// 延長の申請フォーム。送ったあと、サーバー側の表示を読み直す。
// ログインが切れていたら（401）、入力を残したまま、ログインし直す案内を出す（#491）。
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { submitExtensionRequest } from "@/lib/task-extension-panel";
import { SessionExpiredNotice } from "../../session-expired";

export function ExtensionRequestForm({ taskId, currentDueDate }: { taskId: number; currentDueDate: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(undefined);
    setExpired(false);
    const result = await submitExtensionRequest(
      taskId,
      { newDueDate: String(data.get("newDueDate") ?? ""), reason: String(data.get("reason") ?? "") },
      currentDueDate,
      { fetch: (url, init) => fetch(url, init) },
    );
    setPending(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    if (result.status === "expired") {
      setExpired(true);
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form aria-label="延長の申請" onSubmit={onSubmit}>
      <p>
        <label>
          希望の期限 <input type="date" name="newDueDate" />
        </label>
      </p>
      <p>
        <label>
          理由 <textarea name="reason" rows={3} cols={50} />
        </label>
      </p>
      {error && <p role="alert">{error}</p>}
      {expired && (
        <p role="alert" data-testid="extension-session-expired">
          <SessionExpiredNotice />
        </p>
      )}
      <button type="submit" disabled={pending}>
        延長を申請する
      </button>
    </form>
  );
}
