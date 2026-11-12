// ログインとセッション。Next.js に依存しない部分（単体テストの対象）。Cookie の読み書きは session.ts。
import { randomBytes } from "node:crypto";
import { getDb, transaction, type Db } from "./db/index.ts";
import { clearFailures, getLockState, recordFailure } from "./login-throttle.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import type { ValidationResult } from "./tasks.ts";
import type { User } from "./users.ts";

export const SESSION_COOKIE = "poc_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 存在しないユーザーでも同じ計算量でパスワードを照合し、応答時間からユーザーの有無を推測されないようにする。
// ダミーのパスワードは起動ごとにランダムにし、推測で一致させられないようにする。
const DUMMY_HASH = hashPassword(randomBytes(32).toString("hex"));

/** ID とパスワードが正しければユーザーを返す。 */
export function authenticate(userId: string, password: string, db: Db = getDb()): User | undefined {
  const row = db.prepare("SELECT id, name, password_hash FROM users WHERE id = ?").get(userId) as
    | { id: string; name: string; password_hash: string }
    | undefined;
  const ok = verifyPassword(password, row?.password_hash || DUMMY_HASH);
  // パスワード未設定（ハッシュが空）のユーザーはログインさせない。
  if (!row || !row.password_hash || !ok) return undefined;
  return { id: row.id, name: row.name };
}

export type LoginResult =
  | { ok: true; user: User; token: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryAfterMinutes: number };

/**
 * ログインする（POST /api/login の判定）。ロック中なら照合しない。ID・パスワードが誤りなら失敗を数える。
 * 成功したら失敗の回数を消し、セッションを作り、最終ログイン日時を now にする。
 * 成功のときだけ最終ログイン日時を変える。それまでの最終ログイン日時は、作ったセッションに「前回のログイン」として残す。
 * 作ったセッションには、ログインした日時（now）と User-Agent を記録する（ログイン中の端末の一覧で使う）。
 */
export function login(
  userId: unknown,
  password: unknown,
  db: Db = getDb(),
  now: Date = new Date(),
  userAgent: string | null = null,
): LoginResult {
  const lock = typeof userId === "string" ? getLockState(userId, db, now) : { locked: false as const };
  if (lock.locked) return { ok: false, reason: "locked", retryAfterMinutes: lock.retryAfterMinutes };
  const user =
    typeof userId === "string" && typeof password === "string" ? authenticate(userId, password, db) : undefined;
  if (!user) {
    if (typeof userId === "string") recordFailure(userId, db, now);
    return { ok: false, reason: "invalid" };
  }
  const token = transaction(db, () => {
    clearFailures(user.id, db);
    const row = db.prepare("SELECT last_login_at FROM users WHERE id = ?").get(user.id) as
      | { last_login_at: string | null }
      | undefined;
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now.toISOString(), user.id);
    return createSession(user.id, db, now, row?.last_login_at ?? null, userAgent);
  });
  return { ok: true, user, token };
}

export function createSession(
  userId: string,
  db: Db = getDb(),
  now: Date = new Date(),
  previousLoginAt: string | null = null,
  userAgent: string | null = null,
): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at, previous_login_at, created_at, user_agent, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(token, userId, expiresAt, previousLoginAt, now.toISOString(), normalizeUserAgent(userAgent), newDeviceId());
  return token;
}

/** User-Agent の保存できる長さの上限（文字数）。これより長いものは切って保存する。 */
export const USER_AGENT_MAX_LENGTH = 512;

/** 保存する User-Agent。無い・空白だけなら null、長すぎれば上限で切る。 */
export function normalizeUserAgent(userAgent: string | null | undefined): string | null {
  const value = userAgent?.trim();
  if (!value) return null;
  return value.slice(0, USER_AGENT_MAX_LENGTH);
}

function newDeviceId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * 有効なセッションの「前回のログイン」（このセッションでログインする 1 つ前のログイン日時。ISO 8601・UTC）を返す。
 * 前回が無ければ null。期限切れ・不明なトークンは undefined。本人のセッションからだけ読む。
 */
export function getPreviousLogin(token: string | undefined, db: Db = getDb(), now: Date = new Date()): string | null | undefined {
  if (!token) return undefined;
  const row = db
    .prepare("SELECT previous_login_at FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, now.toISOString()) as { previous_login_at: string | null } | undefined;
  return row ? row.previous_login_at : undefined;
}

/** 前回のログインのヘッダーの表示。日時は日本時間の「YYYY/MM/DD HH:mm」、前回が無ければ「なし」。 */
export function formatPreviousLogin(previousLoginAt: string | null): string {
  if (!previousLoginAt) return "前回のログイン: なし";
  return `前回のログイン: ${formatJstDateTime(previousLoginAt)}`;
}

/** ISO 8601 の日時を、日本時間の「YYYY/MM/DD HH:mm」にする。 */
export function formatJstDateTime(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 有効なセッションのユーザーを返す。期限切れ・不明なトークンは undefined。 */
export function getSessionUser(token: string | undefined, db: Db = getDb(), now: Date = new Date()): User | undefined {
  if (!token) return undefined;
  return db
    .prepare("SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?")
    .get(token, now.toISOString()) as User | undefined;
}

export function deleteSession(token: string, db: Db = getDb()): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/**
 * すべての端末からログアウトする。token が有効なセッションなら、その利用者のセッションを
 * （呼んだ端末のもの・期限切れのものを含めて）すべて消し、利用者を返す。
 * 未ログイン（トークンなし・不明・期限切れ）なら何も消さずに undefined を返す。
 */
export function logoutAllDevices(token: string | undefined, db: Db = getDb(), now: Date = new Date()): User | undefined {
  return transaction(db, () => {
    const user = getSessionUser(token, db, now);
    if (user) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    return user;
  });
}

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordChangeInput = { currentPassword: string; newPassword: string };

/** パスワード変更の本文を検証する。文字数は見た目の文字（コードポイント）で数える。 */
export function validatePasswordChangeInput(body: unknown): ValidationResult<PasswordChangeInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const { currentPassword, newPassword } = body as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof currentPassword !== "string" || currentPassword === "") errors.push("今のパスワードを入力してください");
  if (typeof newPassword !== "string" || [...newPassword].length < MIN_PASSWORD_LENGTH) {
    errors.push(`新しいパスワードは ${MIN_PASSWORD_LENGTH} 文字以上で入力してください`);
  } else if (newPassword === currentPassword) {
    errors.push("新しいパスワードは今のパスワードと別のものにしてください");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { currentPassword: currentPassword as string, newPassword: newPassword as string } };
}

export type PasswordChangeResult =
  | { ok: true }
  | { ok: false; reason: "wrong-password" }
  | { ok: false; reason: "locked"; retryAfterMinutes: number };

/**
 * ログイン中の本人のパスワードを変える。今のパスワードが正しければ、ハッシュの更新と
 * 同じ利用者のほかのセッションの削除を 1 つのトランザクションで行い、keepToken のセッションだけを残す。
 * 今のパスワードの誤りはログインの失敗と同じ回数制限に数え、ロック中は照合しない。
 */
export function changePassword(
  userId: string,
  keepToken: string,
  input: PasswordChangeInput,
  db: Db = getDb(),
  now: Date = new Date(),
): PasswordChangeResult {
  const lock = getLockState(userId, db, now);
  if (lock.locked) return { ok: false, reason: "locked", retryAfterMinutes: lock.retryAfterMinutes };
  if (!authenticate(userId, input.currentPassword, db)) {
    recordFailure(userId, db, now);
    return { ok: false, reason: "wrong-password" };
  }
  transaction(db, () => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(input.newPassword), userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token <> ?").run(userId, keepToken);
    clearFailures(userId, db);
  });
  return { ok: true };
}
