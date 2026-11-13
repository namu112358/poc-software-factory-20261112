// 送ったときにログインが切れていた（401）ときの、画面の扱い（#491）。
// 入力は消さずに「ログインが切れました」と出し、ログインし直す案内を出す。ログインし直したら元の画面へ戻す。
// 戻り先（next）は、このアプリの中の画面だけにする（オープンリダイレクトにしない）。

/** ログインが切れていたときに、誤りの表示に出す文。 */
export const SESSION_EXPIRED_MESSAGE = "ログインが切れました。入力はこの画面に残っています。";

/** ログインし直すリンクの名前（新しいタブで開くので、この画面の入力は残る）。 */
export const RELOGIN_LINK_LABEL = "新しいタブでログインし直す（この画面の入力は残ります）";

/** ログインした後に移る既定の画面。 */
export const DEFAULT_AFTER_LOGIN_PATH = "/tasks";

/** 戻り先として受け付ける長さの上限。 */
const MAX_NEXT_LENGTH = 2000;

/** 応答の状態がログイン切れ（401）か。 */
export function isSessionExpired(httpStatus: number): boolean {
  return httpStatus === 401;
}

/**
 * ログインした後の戻り先を検証する。このアプリの中のパス（`/` で始まる）だけを受け付け、
 * それ以外（外のサイト・`//` や `/\` で始まる値・バックスラッシュや制御文字を含む値・ログイン画面自身・配列）は「指定なし」（undefined）。
 */
export function safeNextPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "" || value.length > MAX_NEXT_LENGTH) return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  // ブラウザは `\` を `/` と読むことがあり（`/\evil.example` → `//evil.example`）、制御文字は取り除くことがあるため、含むものは受け付けない。
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  const base = "http://app.invalid";
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return undefined;
  }
  if (url.origin !== base) return undefined;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** ログインした後に移る画面。戻り先が正しくなければ既定の画面。 */
export function afterLoginPath(next: unknown): string {
  return safeNextPath(next) ?? DEFAULT_AFTER_LOGIN_PATH;
}

/** ログイン画面の URL。戻り先が正しいときだけ next を付ける。 */
export function loginPath(next: unknown): string {
  const path = safeNextPath(next);
  return path === undefined ? "/login" : `/login?next=${encodeURIComponent(path)}`;
}

/** 今いる画面（location の pathname・search・hash）へ戻る、ログインし直すリンクの URL。 */
export function reloginHref(location: { pathname: string; search: string; hash?: string }): string {
  return loginPath(`${location.pathname}${location.search}${location.hash ?? ""}`);
}

/** API のエラー応答（`{ error, details? }`）を、ログイン切れか、画面に出す理由の一覧に分ける。 */
export type FormFailure = { expired: true } | { expired: false; messages: string[] };

/** 失敗した応答を読む。401 ならログイン切れ、ほかは details（無ければ error、それも無ければ fallback）を理由にする。 */
export function readFormFailure(httpStatus: number, body: unknown, fallback: string): FormFailure {
  if (isSessionExpired(httpStatus)) return { expired: true };
  const { error, details } = (typeof body === "object" && body !== null ? body : {}) as { error?: unknown; details?: unknown };
  const list = Array.isArray(details) ? details.filter((d): d is string => typeof d === "string") : [];
  if (list.length > 0) return { expired: false, messages: list };
  return { expired: false, messages: [typeof error === "string" && error !== "" ? error : fallback] };
}
