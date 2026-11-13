"use client";
// パスワード変更のフォーム。確認が一致しないときは送信しない。
// ログインが切れていたら（401）、入力を残したまま、ログインし直す案内を出す（#491）。
import { useState } from "react";
import type { FormEvent } from "react";
import {
  PASSWORD_CHANGED_MESSAGE,
  PASSWORD_FAILED_MESSAGE,
  checkPasswordConfirmation,
  passwordErrorMessages,
} from "@/lib/password-form";
import { passwordStrengthText } from "@/lib/password-strength";
import { isSessionExpired } from "@/lib/session-expired";
import { SessionExpiredNotice } from "../../session-expired";

export function PasswordForm() {
  const [errors, setErrors] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const strength = passwordStrengthText(newPassword);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const mismatch = checkPasswordConfirmation(newPassword, String(data.get("confirmPassword") ?? ""));
    setDone(false);
    setExpired(false);
    if (mismatch) {
      setErrors([mismatch]);
      return;
    }
    setErrors([]);
    setPending(true);
    try {
      const res = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        form.reset();
        setNewPassword("");
        setDone(true);
      } else if (isSessionExpired(res.status)) {
        setExpired(true);
      } else {
        setErrors(passwordErrorMessages(await res.json().catch(() => undefined)));
      }
    } catch {
      setErrors([PASSWORD_FAILED_MESSAGE]);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="パスワード変更">
      <p>
        <label>
          今のパスワード <input name="currentPassword" type="password" autoComplete="current-password" required />
        </label>
      </p>
      <p>
        <label>
          新しいパスワード <input name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
      </p>
      {strength && <p data-testid="password-strength">{strength}</p>}
      <p>
        <label>
          新しいパスワード（確認） <input name="confirmPassword" type="password" autoComplete="new-password" required />
        </label>
      </p>
      <button type="submit" disabled={pending}>
        変更
      </button>
      {done && <p role="status">{PASSWORD_CHANGED_MESSAGE}</p>}
      {expired && (
        <p role="alert" data-testid="password-session-expired">
          <SessionExpiredNotice />
        </p>
      )}
      {errors.map((message) => (
        <p key={message} role="alert">
          {message}
        </p>
      ))}
    </form>
  );
}
