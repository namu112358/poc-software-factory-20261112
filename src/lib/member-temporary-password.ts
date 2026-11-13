// メンバーの一覧の「仮のパスワードを出し直す」と、パスワード変更の画面の知らせ（#566）。通信を引数で受け取り、画面に依らずに確かめられるようにする。
// 判定と書き込みは API（POST /api/users/:id/temporary-password）と users.ts の reissueTemporaryPassword が行う。

/** メンバーの一覧の「ログイン」の欄で、仮のパスワードのままの人に添える文言。 */
export const TEMPORARY_PASSWORD_PENDING_LABEL = "仮のパスワードのまま";

/** メンバーの一覧で、その行に出し直しの操作を出すか。取りまとめる人だけに出し、自分の行と停止中の人の行には出さない。 */
export function showReissueControl(viewer: { id: string; isCoordinator: boolean }, member: { id: string; suspended: boolean }): boolean {
  return viewer.isCoordinator && viewer.id !== member.id && !member.suspended;
}

/** 出し直す前に確かめる文言。 */
export function reissueConfirmMessage(name: string): string {
  return `${name} さんに仮のパスワードを出し直しますか？ ${name} さんの今のパスワードは使えなくなり、ログイン中の端末はすべてログアウトします。${name} さんは次のログインで自分のパスワードに変えます。`;
}

/** 出し直した後に、新しい仮のパスワードに添える注意。 */
export function reissuedNotice(name: string): string {
  return `${name} さんの仮のパスワードを出し直しました。この画面を離れると二度と表示されません。いま本人に伝えてください。`;
}

export type ReissueOutcome = { status: "done"; temporaryPassword: string } | { status: "error"; message: string };

type Deps = {
  fetch: (url: string, init: { method: "POST" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

const FALLBACK = "仮のパスワードを出し直せませんでした。";

/** 仮のパスワードを出し直す。成功したら新しい仮のパスワードを、失敗したら画面に出す日本語の理由を返す。 */
export async function requestTemporaryPassword(memberId: string, deps: Deps): Promise<ReissueOutcome> {
  try {
    const res = await deps.fetch(`/api/users/${encodeURIComponent(memberId)}/temporary-password`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { temporaryPassword?: unknown; error?: unknown };
    if (res.ok && typeof data?.temporaryPassword === "string") return { status: "done", temporaryPassword: data.temporaryPassword };
    if (!res.ok && typeof data?.error === "string" && data.error !== "") return { status: "error", message: data.error };
    return { status: "error", message: FALLBACK };
  } catch {
    return { status: "error", message: FALLBACK };
  }
}

/**
 * 出し直された本人に、パスワード変更の画面で出す知らせ。日時は日本時間の「M月D日 H時M分」。
 * 例: 「取りまとめる人 田中 さんが 11月13日 15時17分 に仮のパスワードを出し直しました」
 */
export function reissueNoticeFor(issuerName: string, issuedAt: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(new Date(issuedAt))
      .map((x) => [x.type, x.value]),
  );
  return `取りまとめる人 ${issuerName} さんが ${p.month}月${p.day}日 ${Number(p.hour)}時${Number(p.minute)}分 に仮のパスワードを出し直しました`;
}
