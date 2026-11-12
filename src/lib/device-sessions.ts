// ログイン中の端末（自分の有効なセッション）の一覧と、ほかの端末を切る処理。Next.js に依存しない（単体テストの対象）。
// セッションはトークンではなく端末の ID（device_id）で指定させ、トークンは外に出さない。
import { getDb, transaction, type Db } from "./db/index.ts";
import { formatJstDateTime, getSessionUserAndTouch } from "./auth.ts";

export type DeviceSession = {
  /** 端末の ID（32 桁の 16 進）。切るときの指定に使う。 */
  id: string;
  /** ログインした日時（ISO 8601・UTC）。分からなければ null。 */
  loggedInAt: string | null;
  /** その端末で最後に画面・API を使った日時（ISO 8601・UTC）。記録が始まる前のセッションで、まだ使われていなければ null。 */
  lastUsedAt: string | null;
  /** 端末の種類（例:「Chrome / macOS」「不明な端末」）。 */
  device: string;
  /** 今使っている端末か。 */
  current: boolean;
};

/** 端末の ID の形か（32 桁の 16 進の小文字）。 */
export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

function detectBrowser(ua: string): string | undefined {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/\b(OPR|Opera)\//.test(ua)) return "Opera";
  if (/\b(Firefox|FxiOS)\//.test(ua)) return "Firefox";
  if (/\b(HeadlessChrome|Chrome|CriOS|Chromium)\//.test(ua)) return "Chrome";
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(ua)) return "Safari";
  return undefined;
}

function detectOs(ua: string): string | undefined {
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return "iOS";
  if (/\bAndroid\b/.test(ua)) return "Android";
  if (/\bWindows\b/.test(ua)) return "Windows";
  if (/\bCrOS\b/.test(ua)) return "ChromeOS";
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return "macOS";
  if (/\bLinux\b/.test(ua)) return "Linux";
  return undefined;
}

/**
 * User-Agent から端末の種類を「ブラウザ / OS」で返す。両方分からなければ「不明な端末」、
 * 片方だけ分からなければその側を「不明」とする。
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  if (!browser && !os) return "不明な端末";
  return `${browser ?? "不明"} / ${os ?? "不明"}`;
}

/** ログインした日時の表示。日本時間の「YYYY/MM/DD HH:mm」、分からなければ「不明」。 */
export function formatLoggedInAt(loggedInAt: string | null): string {
  return loggedInAt ? formatJstDateTime(loggedInAt) : "不明";
}

/** 最後に使った日時の表示。日本時間の「YYYY/MM/DD HH:mm」、分からなければ「不明」。 */
export function formatLastUsedAt(lastUsedAt: string | null): string {
  return lastUsedAt ? formatJstDateTime(lastUsedAt) : "不明";
}

/**
 * token のセッションの利用者の、有効なセッションの一覧を、ログインした日時の新しい順（不明なものは最後）に返す。
 * 一覧を見ることも端末の利用なので、今の端末の最後に使った日時を更新してから読む。
 * 未ログイン（トークンなし・不明・期限切れ）なら undefined。
 */
export function listDeviceSessions(
  token: string | undefined,
  db: Db = getDb(),
  now: Date = new Date(),
): DeviceSession[] | undefined {
  const user = getSessionUserAndTouch(token, db, now);
  if (!user) return undefined;
  const rows = db
    .prepare(
      `SELECT device_id, created_at, last_used_at, user_agent, token = ? AS current
       FROM sessions
       WHERE user_id = ? AND expires_at > ?
       ORDER BY created_at IS NULL, created_at DESC, rowid DESC`,
    )
    .all(token as string, user.id, now.toISOString()) as {
    device_id: string;
    created_at: string | null;
    last_used_at: string | null;
    user_agent: string | null;
    current: number;
  }[];
  return rows.map((r) => ({
    id: r.device_id,
    loggedInAt: r.created_at,
    lastUsedAt: r.last_used_at,
    device: describeDevice(r.user_agent),
    current: r.current === 1,
  }));
}

export type RevokeResult = { ok: true } | { ok: false; reason: "unauthorized" | "not-found" | "current" };

/**
 * token のセッションの利用者の、deviceId の端末のセッションを 1 つだけ消す。
 * 未ログインは unauthorized、本人の有効なセッションに無い ID は not-found、今の端末は current で、どれも何も消さない。
 * ログイン中なら、結果によらず今の端末の最後に使った日時を更新する（端末の利用なので）。
 */
export function revokeDeviceSession(
  token: string | undefined,
  deviceId: unknown,
  db: Db = getDb(),
  now: Date = new Date(),
): RevokeResult {
  return transaction(db, (): RevokeResult => {
    const user = getSessionUserAndTouch(token, db, now);
    if (!user) return { ok: false, reason: "unauthorized" };
    if (!isDeviceId(deviceId)) return { ok: false, reason: "not-found" };
    const row = db
      .prepare("SELECT token FROM sessions WHERE device_id = ? AND user_id = ? AND expires_at > ?")
      .get(deviceId, user.id, now.toISOString()) as { token: string } | undefined;
    if (!row) return { ok: false, reason: "not-found" };
    if (row.token === token) return { ok: false, reason: "current" };
    db.prepare("DELETE FROM sessions WHERE device_id = ? AND user_id = ? AND token <> ?").run(
      deviceId,
      user.id,
      token as string,
    );
    return { ok: true };
  });
}
