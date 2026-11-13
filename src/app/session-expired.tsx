"use client";
// 送ったときにログインが切れていたときの案内（#491）。誤りの表示（role="alert"）の中に置く。
// リンクは新しいタブでログイン画面を開き、ログインし直すと今の画面に戻る。この画面の入力はそのまま残る。
import { RELOGIN_LINK_LABEL, SESSION_EXPIRED_MESSAGE, reloginHref } from "@/lib/session-expired";

/** ログインし直すリンク。送った後にだけ出すので、今の画面の URL はブラウザから読む。 */
export function ReloginLink() {
  const href = typeof window === "undefined" ? "/login" : reloginHref(window.location);
  return (
    <a href={href} target="_blank" rel="noopener">
      {RELOGIN_LINK_LABEL}
    </a>
  );
}

/** 「ログインが切れました」の文と、ログインし直すリンク。 */
export function SessionExpiredNotice() {
  return (
    <>
      {SESSION_EXPIRED_MESSAGE} <ReloginLink />
    </>
  );
}
