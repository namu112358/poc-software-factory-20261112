// ログイン失敗の回数制限。同じユーザー ID で続けて失敗したら、一定時間ログインさせない。
// 存在しない ID も同じように数える（応答の違いからユーザーの有無を推測されないようにするため）。
import { getDb, type Db } from "./db/index.ts";

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;

export type LockState = { locked: false } | { locked: true; retryAfterMinutes: number };

/** ロック中か調べる。ロック中なら、あと何分（切り上げ）で試せるかを返す。 */
export function getLockState(userId: string, db: Db = getDb(), now: Date = new Date()): LockState {
  const row = db.prepare("SELECT locked_until FROM login_attempts WHERE user_id = ?").get(userId) as
    | { locked_until: string | null }
    | undefined;
  if (!row?.locked_until) return { locked: false };
  const remainingMs = new Date(row.locked_until).getTime() - now.getTime();
  if (remainingMs <= 0) return { locked: false };
  return { locked: true, retryAfterMinutes: Math.ceil(remainingMs / 60_000) };
}

/** 失敗を 1 回記録する。連続 MAX_FAILURES 回に達したらロックする。ロックが切れた後の失敗は 1 回目から数え直す。 */
export function recordFailure(userId: string, db: Db = getDb(), now: Date = new Date()): void {
  const row = db.prepare("SELECT failures, locked_until FROM login_attempts WHERE user_id = ?").get(userId) as
    | { failures: number; locked_until: string | null }
    | undefined;
  const expired = row?.locked_until !== null && row?.locked_until !== undefined && new Date(row.locked_until) <= now;
  const failures = (row && !expired ? row.failures : 0) + 1;
  const lockedUntil = failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS).toISOString() : null;
  db.prepare(
    `INSERT INTO login_attempts (user_id, failures, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until`,
  ).run(userId, failures, lockedUntil);
}

/** ログインできたときに失敗の回数を 0 に戻す。 */
export function clearFailures(userId: string, db: Db = getDb()): void {
  db.prepare("DELETE FROM login_attempts WHERE user_id = ?").run(userId);
}
