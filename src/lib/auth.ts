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

/**
 * ID とパスワードが正しければユーザーを返す。
 * ログインを停止した利用者は、パスワードが正しくても undefined（ほかの失敗と同じ扱い。停止しているかを外から見分けられないようにする。#522）。
 */
export function authenticate(userId: string, password: string, db: Db = getDb()): User | undefined {
  const row = db.prepare("SELECT id, name, password_hash, suspended_at FROM users WHERE id = ?").get(userId) as
    | { id: string; name: string; password_hash: string; suspended_at: string | null }
    | undefined;
  const ok = verifyPassword(password, row?.password_hash || DUMMY_HASH);
  // パスワード未設定（ハッシュが空）のユーザーはログインさせない。
  if (!row || !row.password_hash || !ok || row.suspended_at !== null) return undefined;
  return { id: row.id, name: row.name };
}

export type LoginResult =
  | { ok: true; user: User; token: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryAfterMinutes: number }
  | { ok: false; reason: "lock-started"; retryAfterMinutes: number };

/**
 * ログインする（POST /api/login の判定）。ロック中なら照合しない。ID・パスワードが誤りなら失敗を数える。
 * 成功したら失敗の回数を消し、セッションを作り、最終ログイン日時を now にする。
 * 成功のときだけ最終ログイン日時を変える。それまでの最終ログイン日時は、作ったセッションに「前回のログイン」として残す。
 * 作ったセッションには、ログインした日時（now）と User-Agent を記録する（ログイン中の端末の一覧で使う）。
 * パスワードの誤りとロック中の試行は、その ID の利用者の「前回のログインのあとの失敗の回数」に数える。
 * 成功したら、その回数をセッションに写して 0 に戻す（ログイン後に知らせる）。
 * 成功したら、ログインの記録（login_events）も 1 行残す（ログイン中のほかの端末に知らせる。login-notices.ts）。
 * この誤りでロックした（続けて MAX_FAILURES 回目）ときは "lock-started" と、あと何分で試せるかを返す。
 * 成功したら、前回のログインのあとにロックされた回数と最後の日時もセッションに写し、0 と NULL に戻す（ログイン後に知らせる）。
 */
export function login(
  userId: unknown,
  password: unknown,
  db: Db = getDb(),
  now: Date = new Date(),
  userAgent: string | null = null,
): LoginResult {
  const lock = typeof userId === "string" ? getLockState(userId, db, now) : { locked: false as const };
  if (lock.locked) {
    countFailedLogin(userId as string, db);
    return { ok: false, reason: "locked", retryAfterMinutes: lock.retryAfterMinutes };
  }
  const user =
    typeof userId === "string" && typeof password === "string" ? authenticate(userId, password, db) : undefined;
  if (!user) {
    if (typeof userId === "string") {
      const locked = transaction(db, () => {
        const state = recordFailure(userId, db, now);
        countFailedLogin(userId, db);
        return state;
      });
      if (locked.locked) return { ok: false, reason: "lock-started", retryAfterMinutes: locked.retryAfterMinutes };
    }
    return { ok: false, reason: "invalid" };
  }
  const token = transaction(db, () => {
    clearFailures(user.id, db);
    const row = db
      .prepare("SELECT last_login_at, failed_logins_since_login, locks_since_login, last_locked_at FROM users WHERE id = ?")
      .get(user.id) as
      | { last_login_at: string | null; failed_logins_since_login: number; locks_since_login: number; last_locked_at: string | null }
      | undefined;
    db.prepare(
      "UPDATE users SET last_login_at = ?, failed_logins_since_login = 0, locks_since_login = 0, last_locked_at = NULL WHERE id = ?",
    ).run(
      now.toISOString(),
      user.id,
    );
    // ログインの記録は、セッションを作る前に残す（作ったセッションが自分のログインを「確かめた」扱いにするため）。
    db.prepare(
      "INSERT INTO login_events (user_id, logged_in_at, user_agent, failed_logins_before) VALUES (?, ?, ?, ?)",
    ).run(user.id, now.toISOString(), normalizeUserAgent(userAgent), row?.failed_logins_since_login ?? 0);
    const sessionToken = createSession(
      user.id,
      db,
      now,
      row?.last_login_at ?? null,
      userAgent,
      row?.failed_logins_since_login ?? 0,
    );
    if (row && row.locks_since_login > 0) {
      db.prepare("UPDATE sessions SET locks_before = ?, last_locked_at_before = ? WHERE token = ?").run(
        row.locks_since_login,
        row.last_locked_at,
        sessionToken,
      );
    }
    return sessionToken;
  });
  return { ok: true, user, token };
}

export function createSession(
  userId: string,
  db: Db = getDb(),
  now: Date = new Date(),
  previousLoginAt: string | null = null,
  userAgent: string | null = null,
  failedLoginsBefore = 0,
): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  // その時点までの自分のログインの記録は、このセッションには知らせない（自分より前のログインは知らせない）。
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, previous_login_at, created_at, last_used_at, user_agent, device_id, failed_logins_before, login_notices_seen_through)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM login_events WHERE user_id = ?))`,
  ).run(
    token,
    userId,
    expiresAt,
    previousLoginAt,
    now.toISOString(),
    now.toISOString(),
    normalizeUserAgent(userAgent),
    newDeviceId(),
    failedLoginsBefore,
    userId,
  );
  return token;
}

/**
 * パスワードを誤った（またはロック中に試された）ログインを、その ID の利用者の回数に 1 足す。
 * 存在しない ID は更新する行が無いので、どの利用者の回数にも入らない。
 */
function countFailedLogin(userId: string, db: Db): void {
  db.prepare("UPDATE users SET failed_logins_since_login = failed_logins_since_login + 1 WHERE id = ?").run(userId);
}

/**
 * 有効なセッションの「ログインした時点で、前回のログインのあとにパスワードを誤ったログインの回数」を返す。
 * ログインした時点で決まり、そのあとの失敗では変わらない。期限切れ・不明なトークンは undefined。本人のセッションからだけ読む。
 */
export function getFailedLoginsBefore(token: string | undefined, db: Db = getDb(), now: Date = new Date()): number | undefined {
  if (!token) return undefined;
  const row = db
    .prepare("SELECT failed_logins_before FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, now.toISOString()) as { failed_logins_before: number } | undefined;
  return row?.failed_logins_before;
}

/** ログイン後の失敗の知らせの文言。回数が 0 以下（または不明）なら出さない（undefined）。 */
export function formatFailedLoginNotice(count: number | undefined): string | undefined {
  if (!count || count < 1) return undefined;
  return `前回のログインのあと、パスワードを誤ったログインが ${count} 回ありました`;
}

export type LockNotice = {
  /** 前回のログインのあと、このログインまでにロックされた回数（1 以上）。 */
  count: number;
  /** 最後にロックされた日時（ISO 8601・UTC）。 */
  lastLockedAt: string;
};

/**
 * 有効なセッションの「ログインした時点で、前回のログインのあとにロックされた回数と最後の日時」を返す。
 * ログインした時点で決まり、そのあとのロックでは変わらない。ロックされていなければ null、期限切れ・不明なトークンは undefined。
 * 本人のセッションからだけ読む。
 */
export function getLockNotice(token: string | undefined, db: Db = getDb(), now: Date = new Date()): LockNotice | null | undefined {
  if (!token) return undefined;
  const row = db
    .prepare("SELECT locks_before, last_locked_at_before FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, now.toISOString()) as { locks_before: number; last_locked_at_before: string | null } | undefined;
  if (!row) return undefined;
  if (row.locks_before < 1 || !row.last_locked_at_before) return null;
  return { count: row.locks_before, lastLockedAt: row.last_locked_at_before };
}

/** ログイン後のロックの知らせの文言。ロックされていない（null・不明）なら出さない（undefined）。 */
export function formatLockNotice(notice: LockNotice | null | undefined): string | undefined {
  if (!notice) return undefined;
  return `前回のログインのあと、ログインが ${notice.count} 回ロックされました（最後は ${formatJstDateTime(notice.lastLockedAt)}）`;
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

/**
 * 有効なセッションのユーザーを返す。期限切れ・不明なトークンは undefined。
 * ログインを停止した利用者のセッションも undefined（停止のときにセッションは消すが、残っていても通さない。#522）。
 */
export function getSessionUser(token: string | undefined, db: Db = getDb(), now: Date = new Date()): User | undefined {
  if (!token) return undefined;
  return db
    .prepare(
      "SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.suspended_at IS NULL",
    )
    .get(token, now.toISOString()) as User | undefined;
}

/** 最後に使った日時を更新しない間隔（ミリ秒）。前の値からこの時間を過ぎた利用のときだけ更新する。 */
export const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 有効なセッションの「最後に使った日時」を now にする。ただし前の値から LAST_USED_UPDATE_INTERVAL_MS を
 * 過ぎていなければ（ちょうどを含む）更新しない。前の値が無い（記録が始まる前のセッション）なら更新する。
 * 前の値が now より後（時計のずれ）なら戻さない。判定は 1 つの UPDATE の中で行い、token の行だけを変える。
 * 有効期限は延ばさない。更新したら true。
 */
export function touchSession(token: string | undefined, db: Db = getDb(), now: Date = new Date()): boolean {
  if (!token) return false;
  const threshold = new Date(now.getTime() - LAST_USED_UPDATE_INTERVAL_MS).toISOString();
  const result = db
    .prepare(
      "UPDATE sessions SET last_used_at = ? WHERE token = ? AND expires_at > ? AND (last_used_at IS NULL OR last_used_at < ?)",
    )
    .run(now.toISOString(), token, now.toISOString(), threshold);
  return Number(result.changes) > 0;
}

/** 有効なセッションのユーザーを返し、そのセッションの最後に使った日時を更新する（touchSession）。画面・API の利用で使う。 */
export function getSessionUserAndTouch(token: string | undefined, db: Db = getDb(), now: Date = new Date()): User | undefined {
  const user = getSessionUser(token, db, now);
  if (user) touchSession(token, db, now);
  return user;
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

/**
 * 有効なセッションの、ログインした時点の「前回のログイン」と「今回のログイン」の日時（ISO 8601・UTC）。
 * 期限切れ・不明なトークン・ログインの日時が記録されていない古いセッションは undefined。
 */
export function getLoginWindow(
  token: string | undefined,
  db: Db = getDb(),
  now: Date = new Date(),
): { previousLoginAt: string | null; loginAt: string } | undefined {
  if (!token) return undefined;
  const row = db
    .prepare("SELECT previous_login_at, created_at FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, now.toISOString()) as { previous_login_at: string | null; created_at: string | null } | undefined;
  if (!row || !row.created_at) return undefined;
  return { previousLoginAt: row.previous_login_at, loginAt: row.created_at };
}
