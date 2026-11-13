"use client";
// メンバーの一覧の「メンバーを加える」フォーム（#523）。取りまとめる人にだけ出す。
// 作ったら、仮のパスワードをこの場で 1 回だけ見せ、一覧を読み込み直す（仮のパスワードは画面を離れると二度と出ない）。
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { TEMPORARY_PASSWORD_SHOWN_ONCE, addMember } from "@/lib/member-create";

type Created = { id: string; name: string; temporaryPassword: string };

export function AddMemberForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [created, setCreated] = useState<Created>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setErrors([]);
    setCreated(undefined);
    setPending(true);
    const result = await addMember(String(data.get("userId") ?? ""), String(data.get("name") ?? ""), {
      fetch: (url, init) => fetch(url, init),
    });
    setPending(false);
    if (result.status === "error") {
      setErrors(result.messages);
      return;
    }
    form.reset();
    setCreated({ ...result.user, temporaryPassword: result.temporaryPassword });
    router.refresh();
  }

  return (
    <section aria-labelledby="add-member-heading">
      <h2 id="add-member-heading">メンバーを加える</h2>
      <form onSubmit={onSubmit} aria-label="メンバーを加える">
        <p>
          <label>
            ID{" "}
            <input
              name="userId"
              required
              autoComplete="off"
              spellCheck={false}
              aria-describedby="add-member-id-rule"
            />
          </label>{" "}
          <small id="add-member-id-rule">英小文字・数字・「-」・「_」で 3〜32 文字。先頭は英小文字。ログインに使います。</small>
        </p>
        <p>
          <label>
            名前 <input name="name" required autoComplete="off" aria-describedby="add-member-name-rule" />
          </label>{" "}
          <small id="add-member-name-rule">50 文字まで。</small>
        </p>
        <button type="submit" disabled={pending} data-testid="add-member-submit">
          {pending ? "作成中…" : "アカウントを作る"}
        </button>
      </form>
      {errors.map((message) => (
        <p key={message} role="alert">
          {message}
        </p>
      ))}
      {created && (
        <div role="status" data-testid="add-member-created">
          <p>
            {created.name} さん（{created.id}）のアカウントを作りました。仮のパスワード:{" "}
            <code data-testid="temporary-password">{created.temporaryPassword}</code>
          </p>
          <p>{TEMPORARY_PASSWORD_SHOWN_ONCE}</p>
        </div>
      )}
    </section>
  );
}
