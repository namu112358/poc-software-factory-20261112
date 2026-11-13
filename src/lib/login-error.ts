// ログインの画面に出す誤りの文言（#479）。ログインの API が画面へ戻すときのクエリ（error・minutes）から作る。
import { LOCK_MS } from "./login-throttle.ts";
import { safeNextPath } from "./session-expired.ts";

/** ロックで試せない残りの分の上限（ロックの長さ）。 */
const MAX_RETRY_AFTER_MINUTES = Math.ceil(LOCK_MS / 60_000);

/** クエリの minutes を検証する。1 以上・ロックの長さ以下の整数だけを受け付け、それ以外は「指定なし」（undefined）。 */
export function parseRetryAfterMinutes(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[0-9]{1,3}$/.test(value)) return undefined;
  const minutes = Number(value);
  return minutes >= 1 && minutes <= MAX_RETRY_AFTER_MINUTES ? minutes : undefined;
}

/**
 * ログインに失敗したときに画面へ戻す先。ロックのときは、あと何分かも渡す。
 * ログインした後の戻り先（next）が正しければ、それも渡す（誤ってもう一度ログインしても、元の画面に戻れるように。#491）。
 */
export function loginErrorPath(
  result: { reason: "invalid" } | { reason: "locked" | "lock-started"; retryAfterMinutes: number },
  next?: unknown,
): string {
  const path = safeNextPath(next);
  const nextParam = path === undefined ? "" : `&next=${encodeURIComponent(path)}`;
  if (result.reason === "invalid") return `/login?error=1${nextParam}`;
  return `/login?error=${result.reason}&minutes=${result.retryAfterMinutes}${nextParam}`;
}

/**
 * 画面に出す誤りの文言。error が無ければ undefined。
 * locked はロック中の試行、lock-started はこの誤りでロックしたとき。分が分からなければ、分を出さずに案内する。
 */
export function formatLoginError(error: unknown, minutes: unknown): string | undefined {
  if (error === undefined) return undefined;
  const retryAfter = parseRetryAfterMinutes(minutes);
  const wait = retryAfter ? `あと ${retryAfter} 分でログインできます。` : "しばらくしてからもう一度お試しください。";
  if (error === "locked") return `ログインに続けて失敗したため、ログインがロックされています。${wait}`;
  if (error === "lock-started") {
    return `ID またはパスワードが正しくありません。続けて失敗したため、ログインをロックしました。${wait}`;
  }
  return "ID またはパスワードが正しくありません。";
}
