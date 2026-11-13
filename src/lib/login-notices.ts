// ほかの端末で新しくログインがあったことを、ログイン中の自分の端末に知らせる（#478）。Next.js に依存しない（単体テストの対象）。
// ログインの記録（login_events）のうち、そのセッションが確かめた位置（sessions.login_notices_seen_through）より後のものを知らせる。
// セッションは作ったときに、その時点までの自分の記録を確かめた扱いになる（auth.ts の createSession）。
import { getDb, type Db } from "./db/index.ts";
import { formatJstDateTime } from "./auth.ts";
import { describeDevice } from "./device-sessions.ts";
import type { ValidationResult } from "./task-types.ts";

export type LoginNotice = {
  /** 知らせに含めた、いちばん新しいログインの記録の ID。「確かめた」で送り返す。 */
  throughId: number;
  /** 知らせに含めた新しいログインの件数（1 以上）。 */
  count: number;
  /** いちばん新しいログインの端末の種類（例:「Chrome / Windows」「不明な端末」）と日時（ISO 8601・UTC）。 */
  latest: { device: string; loggedInAt: string };
  /** それらのログインの前に、パスワードを誤ったログインの回数の合計。 */
  failedLogins: number;
};

type SessionRow = { user_id: string; seen: number };

function findSession(token: string | undefined, db: Db, now: Date): SessionRow | undefined {
  if (!token) return undefined;
  return db
    .prepare("SELECT user_id, login_notices_seen_through AS seen FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, now.toISOString()) as SessionRow | undefined;
}

/**
 * token のセッションに出す、新しいログインの知らせ。知らせることが無ければ null、未ログイン（トークンなし・不明・期限切れ）なら undefined。
 * 同じ利用者のログインの記録のうち、このセッションが確かめた位置より後のものだけを数える（ほかの利用者のものは数えない）。
 */
export function getLoginNotice(token: string | undefined, db: Db = getDb(), now: Date = new Date()): LoginNotice | null | undefined {
  const session = findSession(token, db, now);
  if (!session) return undefined;
  const summary = db
    .prepare(
      "SELECT COUNT(*) AS count, MAX(id) AS through_id, COALESCE(SUM(failed_logins_before), 0) AS failed FROM login_events WHERE user_id = ? AND id > ?",
    )
    .get(session.user_id, session.seen) as { count: number; through_id: number | null; failed: number };
  if (!summary.count || summary.through_id === null) return null;
  const latest = db
    .prepare("SELECT logged_in_at, user_agent FROM login_events WHERE id = ?")
    .get(summary.through_id) as { logged_in_at: string; user_agent: string | null };
  return {
    throughId: summary.through_id,
    count: summary.count,
    latest: { device: describeDevice(latest.user_agent), loggedInAt: latest.logged_in_at },
    failedLogins: summary.failed,
  };
}

/** 知らせの文言（1 行目: 新しいログイン、2 行目以降: ほかの件数・誤りの回数）。 */
export function formatLoginNotice(notice: LoginNotice): string[] {
  const lines = [`新しいログインがありました: ${notice.latest.device}、${formatJstDateTime(notice.latest.loggedInAt)}`];
  if (notice.count > 1) lines.push(`このほかにも、新しいログインが ${notice.count - 1} 回ありました`);
  if (notice.failedLogins > 0) lines.push(`その前に、パスワードを誤ったログインが ${notice.failedLogins} 回ありました`);
  return lines;
}

/** 「確かめた」の本文を検証する。throughId は 1 以上の整数（知らせの throughId をそのまま送る）。 */
export function validateAcknowledgeInput(body: unknown): ValidationResult<{ throughId: number }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません"] };
  }
  const { throughId } = body as Record<string, unknown>;
  if (typeof throughId !== "number" || !Number.isSafeInteger(throughId) || throughId < 1) {
    return { ok: false, errors: ["throughId は 1 以上の整数で指定してください"] };
  }
  return { ok: true, value: { throughId } };
}

/**
 * token のセッションで、throughId の記録までを確かめた扱いにする。このセッションの分だけを変え、ほかの端末の知らせは消さない。
 * 確かめた位置は後ろに戻さない。まだ無い先の ID は、今ある自分の最新の記録までに丸める（後から来るログインを先回りで消さない）。
 * 未ログインなら false（何も変えない）。
 */
export function acknowledgeLoginNotices(
  token: string | undefined,
  throughId: number,
  db: Db = getDb(),
  now: Date = new Date(),
): boolean {
  if (!token) return false;
  const result = db
    .prepare(
      `UPDATE sessions
       SET login_notices_seen_through = MAX(
         login_notices_seen_through,
         MIN(?, (SELECT COALESCE(MAX(id), 0) FROM login_events WHERE user_id = sessions.user_id))
       )
       WHERE token = ? AND expires_at > ?`,
    )
    .run(throughId, token, now.toISOString());
  return Number(result.changes) > 0;
}

/** token のセッションで、今ある自分のログインの記録をすべて確かめた扱いにする（ログイン中の端末の画面を開いたとき）。 */
export function acknowledgeAllLoginNotices(token: string | undefined, db: Db = getDb(), now: Date = new Date()): boolean {
  return acknowledgeLoginNotices(token, Number.MAX_SAFE_INTEGER, db, now);
}
