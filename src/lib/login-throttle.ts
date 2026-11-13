// ログイン失敗の回数制限（#526）。2 つの数え方で、一定時間ログインさせない。
// - 組ごと: 「入力された ID と接続元」の組で続けて MAX_FAILURES 回失敗したら、その組だけを LOCK_MS ロックする。
//   ほかの接続元からは、本人が今までどおりログインできる（ID だけ知っている人に本人を締め出させない）。
//   接続元が分からない（source が null・空）ときは、すべて同じ組（''）になり、今までどおり ID ごとに数える。
// - アカウント全体: 接続元をまたいで ACCOUNT_WINDOW_MS のあいだに ACCOUNT_MAX_FAILURES 回失敗したら、その ID 全体を LOCK_MS ロックする（総当たりへの守り）。
// 存在しない ID も同じように数える（応答の違いからユーザーの有無を推測されないようにするため）。
import { getDb, savepoint, type Db } from "./db/index.ts";

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const ACCOUNT_MAX_FAILURES = 30;
export const ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

export type LockState = { locked: false } | { locked: true; retryAfterMinutes: number };

/** 接続元の値。見分けられなければ ''（ID ごとに数える組）。 */
function sourceKey(source: string | null | undefined): string {
  return source ?? "";
}

function lockStateUntil(lockedUntil: string | null | undefined, now: Date): LockState {
  if (!lockedUntil) return { locked: false };
  const remainingMs = new Date(lockedUntil).getTime() - now.getTime();
  if (remainingMs <= 0) return { locked: false };
  return { locked: true, retryAfterMinutes: Math.ceil(remainingMs / 60_000) };
}

/**
 * ロック中か調べる。組のロックとアカウント全体のロックのどちらかが効いていればロック中で、
 * 長く残るほうの、あと何分（切り上げ）で試せるかを返す。
 */
export function getLockState(
  userId: string,
  db: Db = getDb(),
  now: Date = new Date(),
  source: string | null = null,
): LockState {
  const pair = db
    .prepare("SELECT locked_until FROM login_attempts WHERE user_id = ? AND source = ?")
    .get(userId, sourceKey(source)) as { locked_until: string | null } | undefined;
  const account = db.prepare("SELECT locked_until FROM account_login_locks WHERE user_id = ?").get(userId) as
    | { locked_until: string }
    | undefined;
  const states = [lockStateUntil(pair?.locked_until, now), lockStateUntil(account?.locked_until, now)];
  const minutes = states.map((s) => (s.locked ? s.retryAfterMinutes : 0));
  const max = Math.max(...minutes);
  return max > 0 ? { locked: true, retryAfterMinutes: max } : { locked: false };
}

/**
 * 失敗を 1 回記録する。組で続けて MAX_FAILURES 回に達したら、その組をロックする。ロックが切れた後の失敗は 1 回目から数え直す。
 * あわせてアカウント全体の失敗にも数え、直前 ACCOUNT_WINDOW_MS に ACCOUNT_MAX_FAILURES 回に達したら、その ID 全体をロックする
 * （ロックしたら全体の数は 0 から数え直す）。
 * この失敗でロックしたら、あと何分（切り上げ）で試せるかを返し、その ID の利用者の「前回のログインのあとにロックされた回数」を
 * 1 つ増やして、最後にロックされた日時を now にする（ログイン後に知らせる。存在しない ID はどの利用者にも数えない）。
 * ロックしなければ { locked: false }。ロック中の試行では呼ばない（ロックを延ばさない）。
 */
export function recordFailure(
  userId: string,
  db: Db = getDb(),
  now: Date = new Date(),
  source: string | null = null,
): LockState {
  return savepoint(db, () => {
    const key = sourceKey(source);
    const row = db
      .prepare("SELECT failures, locked_until FROM login_attempts WHERE user_id = ? AND source = ?")
      .get(userId, key) as { failures: number; locked_until: string | null } | undefined;
    const expired = row?.locked_until !== null && row?.locked_until !== undefined && new Date(row.locked_until) <= now;
    const failures = (row && !expired ? row.failures : 0) + 1;
    const pairLockedUntil = failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS).toISOString() : null;
    db.prepare(
      `INSERT INTO login_attempts (user_id, source, failures, locked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, source) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until`,
    ).run(userId, key, failures, pairLockedUntil);

    const accountLocked = recordAccountFailure(userId, db, now);
    if (!pairLockedUntil && !accountLocked) return { locked: false };
    db.prepare("UPDATE users SET locks_since_login = locks_since_login + 1, last_locked_at = ? WHERE id = ?").run(
      now.toISOString(),
      userId,
    );
    return { locked: true, retryAfterMinutes: Math.ceil(LOCK_MS / 60_000) };
  });
}

/** アカウント全体の失敗を 1 回記録し、直前 ACCOUNT_WINDOW_MS の数が上限に達したらロックする。ロックしたら true。 */
function recordAccountFailure(userId: string, db: Db, now: Date): boolean {
  const windowStart = new Date(now.getTime() - ACCOUNT_WINDOW_MS).toISOString();
  db.prepare("DELETE FROM login_failure_log WHERE user_id = ? AND failed_at <= ?").run(userId, windowStart);
  db.prepare("INSERT INTO login_failure_log (user_id, failed_at) VALUES (?, ?)").run(userId, now.toISOString());
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM login_failure_log WHERE user_id = ? AND failed_at > ?")
    .get(userId, windowStart) as { n: number };
  if (n < ACCOUNT_MAX_FAILURES) return false;
  db.prepare(
    `INSERT INTO account_login_locks (user_id, locked_until) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET locked_until = excluded.locked_until`,
  ).run(userId, new Date(now.getTime() + LOCK_MS).toISOString());
  db.prepare("DELETE FROM login_failure_log WHERE user_id = ?").run(userId);
  return true;
}

/**
 * ログインできたときに、その組（ID と接続元）の失敗の回数を 0 に戻す。
 * アカウント全体の数とロックは戻さない（本人がほかの場所からログインしても、総当たりへの守りを消さないため）。
 */
export function clearFailures(userId: string, db: Db = getDb(), source: string | null = null): void {
  db.prepare("DELETE FROM login_attempts WHERE user_id = ? AND source = ?").run(userId, sourceKey(source));
}
