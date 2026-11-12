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

export function createSession(userId: string, db: Db = getDb(), now: Date = new Date()): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
  return token;
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
