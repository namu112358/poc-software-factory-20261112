// ログインがロックされたとき、あと何分かを出し、明けたあとのログインでロックされたことを本人に知らせる（#479）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  changePassword,
  createSession,
  formatFailedLoginNotice,
  formatLockNotice,
  getFailedLoginsBefore,
  getLockNotice,
  login,
} from "../src/lib/auth.ts";
import { migrate, openDb, type Db } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { formatLoginError, loginErrorPath, parseRetryAfterMinutes } from "../src/lib/login-error.ts";
import { LOCK_MS, MAX_FAILURES, getLockState } from "../src/lib/login-throttle.ts";
import { toMeResponse } from "../src/lib/me.ts";

const T0 = new Date("2026-11-13T01:50:00.000Z"); // 日本時間 10:50
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const afterLock = (from: Date) => new Date(from.getTime() + LOCK_MS);

function tokenOf(result: ReturnType<typeof login>): string {
  assert.equal(result.ok, true);
  return (result as { token: string }).token;
}

function fail(db: Db, userId: string, times: number, now = T0): ReturnType<typeof login>[] {
  const results: ReturnType<typeof login>[] = [];
  for (let i = 0; i < times; i++) results.push(login(userId, "wrong-password", db, now));
  return results;
}

describe("ロック中にログインしようとしたときの「あと N 分」", () => {
  it("ロック中の試行は、残りの分（切り上げ）を返し、画面にも同じ分を渡す", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    // 残り 14 分 1 秒 → 15 分
    const result = login("suzuki", SEED_PASSWORD, db, new Date(T0.getTime() + 59_000));
    assert.deepEqual(result, { ok: false, reason: "locked", retryAfterMinutes: 15 });
    assert.equal(loginErrorPath(result as { reason: "locked"; retryAfterMinutes: number }), "/login?error=locked&minutes=15");
    // 残り 30 秒 → 1 分
    const late = login("suzuki", SEED_PASSWORD, db, new Date(T0.getTime() + LOCK_MS - 30_000));
    assert.deepEqual(late, { ok: false, reason: "locked", retryAfterMinutes: 1 });
  });

  it("画面には API と同じ分で「あと N 分でログインできます」と出る", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    const result = login("suzuki", SEED_PASSWORD, db, at(3)) as { reason: "locked"; retryAfterMinutes: number };
    const query = new URL(loginErrorPath(result), "http://localhost").searchParams;
    const message = formatLoginError(query.get("error") ?? undefined, query.get("minutes") ?? undefined);
    assert.equal(result.retryAfterMinutes, 12);
    assert.match(message!, /ロックされています/);
    assert.match(message!, /あと 12 分でログインできます/);
  });

  it("ロックが明ける時刻ちょうどには、ロック中とせずにログインできる", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    assert.equal(login("suzuki", SEED_PASSWORD, db, afterLock(T0)).ok, true);
  });
});

describe("ロックにつながった 5 回目の誤り", () => {
  it("4 回目までは「誤り」、5 回目は「ロックした」とあと 15 分、6 回目からは「ロック中」", () => {
    const db = openDb();
    const results = fail(db, "suzuki", MAX_FAILURES + 1, T0);
    for (const r of results.slice(0, MAX_FAILURES - 1)) assert.deepEqual(r, { ok: false, reason: "invalid" });
    assert.deepEqual(results[MAX_FAILURES - 1], { ok: false, reason: "lock-started", retryAfterMinutes: 15 });
    assert.deepEqual(results[MAX_FAILURES], { ok: false, reason: "locked", retryAfterMinutes: 15 });
  });

  it("画面には、誤りとロックしたことと、あと何分かが出る", () => {
    const db = openDb();
    const fifth = fail(db, "suzuki", MAX_FAILURES, T0).at(-1) as { reason: "lock-started"; retryAfterMinutes: number };
    const path = loginErrorPath(fifth);
    assert.equal(path, "/login?error=lock-started&minutes=15");
    const message = formatLoginError("lock-started", "15")!;
    assert.match(message, /ID またはパスワードが正しくありません/);
    assert.match(message, /ログインをロックしました/);
    assert.match(message, /あと 15 分でログインできます/);
  });

  it("存在しない ID でも、5 回目は同じように「ロックした」を返す（ID の有無を応答で見分けられない）", () => {
    const db = openDb();
    const results = fail(db, "nobody", MAX_FAILURES, T0);
    assert.deepEqual(results.at(-1), { ok: false, reason: "lock-started", retryAfterMinutes: 15 });
  });

  it("ロックが明けたあとは 1 回目から数え直し、また 5 回目でロックしたと返す", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    const again = fail(db, "suzuki", MAX_FAILURES, afterLock(T0));
    assert.deepEqual(again.at(-2), { ok: false, reason: "invalid" });
    assert.deepEqual(again.at(-1), { ok: false, reason: "lock-started", retryAfterMinutes: 15 });
  });
});

describe("画面の誤りの文言と、クエリの minutes の検証", () => {
  it("minutes が 1〜15 の整数のときだけ受け付ける", () => {
    assert.equal(parseRetryAfterMinutes("1"), 1);
    assert.equal(parseRetryAfterMinutes("15"), 15);
    for (const bad of [undefined, "", "0", "16", "-1", "1.5", "abc", "1e1", " 3", ["3"]]) {
      assert.equal(parseRetryAfterMinutes(bad), undefined, String(bad));
    }
  });

  it("minutes が不正なら、分を出さずに案内する", () => {
    assert.equal(
      formatLoginError("locked", "999"),
      "ログインに続けて失敗したため、ログインがロックされています。しばらくしてからもう一度お試しください。",
    );
    assert.doesNotMatch(formatLoginError("lock-started", undefined)!, /あと/);
  });

  it("ID・パスワードの誤りは今の文言のまま、error が無ければ何も出さない", () => {
    assert.equal(formatLoginError("1", undefined), "ID またはパスワードが正しくありません。");
    assert.equal(formatLoginError(undefined, "5"), undefined);
    assert.equal(loginErrorPath({ reason: "invalid" }), "/login?error=1");
  });
});

describe("ロックが明けたあとのログインで、ロックされたことを知らせる", () => {
  it("前回のログインのあとにロックされた回数と最後の日時が出る", () => {
    const db = openDb();
    tokenOf(login("suzuki", SEED_PASSWORD, db, at(-60)));
    fail(db, "suzuki", MAX_FAILURES, T0);
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, afterLock(T0)));
    const notice = getLockNotice(token, db, afterLock(T0));
    assert.deepEqual(notice, { count: 1, lastLockedAt: T0.toISOString() });
    assert.equal(formatLockNotice(notice), "前回のログインのあと、ログインが 1 回ロックされました（最後は 2026/11/13 10:50）");
  });

  it("ロックされていなければ出ない（誤りが 4 回まででも出ない）", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES - 1, T0);
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, at(1)));
    assert.equal(getLockNotice(token, db, at(1)), null);
    assert.equal(formatLockNotice(null), undefined);
  });

  it("ロック → 明ける → もう一度ロックなら 2 回で、最後は 2 回目の日時", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    const second = afterLock(T0);
    fail(db, "suzuki", MAX_FAILURES, second);
    const loginAt = afterLock(second);
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, loginAt));
    assert.deepEqual(getLockNotice(token, db, loginAt), { count: 2, lastLockedAt: second.toISOString() });
  });

  it("ロック中の試行ではロックの回数は増えない", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    fail(db, "suzuki", 4, at(5));
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, afterLock(T0)));
    assert.equal(getLockNotice(token, db, afterLock(T0))?.count, 1);
  });

  it("知らせたログインの次のログインでは出ない（同じロックを 2 度知らせない）", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    const first = tokenOf(login("suzuki", SEED_PASSWORD, db, afterLock(T0)));
    assert.equal(getLockNotice(first, db, afterLock(T0))?.count, 1);
    const next = at(30);
    const second = tokenOf(login("suzuki", SEED_PASSWORD, db, next));
    assert.equal(getLockNotice(second, db, next), null);
    // 先のセッションの知らせは、ログインした時点の値のまま
    assert.equal(getLockNotice(first, db, next)?.count, 1);
  });

  it("日本時間で日付をまたぐ時刻も、日本時間で出す", () => {
    const lockedAt = "2026-11-13T15:30:00.000Z"; // 日本時間 11/14 00:30
    assert.equal(
      formatLockNotice({ count: 3, lastLockedAt: lockedAt }),
      "前回のログインのあと、ログインが 3 回ロックされました（最後は 2026/11/14 00:30）",
    );
  });

  it("誤りの回数の知らせと並んで出る（誤りの回数は今までどおり、ロック中の試行も数える）", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    fail(db, "suzuki", 4, at(1));
    login("suzuki", SEED_PASSWORD, db, at(2)); // ロック中に本人が正しいパスワードを入れた
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, afterLock(T0)));
    assert.equal(getFailedLoginsBefore(token, db, afterLock(T0)), MAX_FAILURES + 5);
    assert.equal(
      formatFailedLoginNotice(getFailedLoginsBefore(token, db, afterLock(T0))),
      `前回のログインのあと、パスワードを誤ったログインが ${MAX_FAILURES + 5} 回ありました`,
    );
    assert.equal(getLockNotice(token, db, afterLock(T0))?.count, 1);
  });

  it("ほかの利用者・存在しない ID のロックは数えない", () => {
    const db = openDb();
    fail(db, "sato", MAX_FAILURES, T0);
    fail(db, "nobody", MAX_FAILURES, T0);
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, at(1)));
    assert.equal(getLockNotice(token, db, at(1)), null);
    const users = db.prepare("SELECT COUNT(*) AS n FROM users WHERE locks_since_login > 0").get() as { n: number };
    assert.equal(users.n, 1); // sato だけ
  });

  it("ID が文字列でない送信では、ロックも回数も変えない", () => {
    const db = openDb();
    for (let i = 0; i < MAX_FAILURES; i++) assert.deepEqual(login(undefined, "x", db, T0), { ok: false, reason: "invalid" });
    const n = db.prepare("SELECT COALESCE(SUM(locks_since_login), 0) AS n FROM users").get() as { n: number };
    assert.equal(n.n, 0);
  });

  it("パスワードの変更で今のパスワードを 5 回誤ってロックしたときも、次のログインで知らせる", () => {
    const db = openDb();
    const current = createSession("suzuki", db, at(-1));
    for (let i = 0; i < MAX_FAILURES; i++) {
      changePassword("suzuki", current, { currentPassword: "wrong", newPassword: "new-password-1" }, db, T0);
    }
    assert.equal(getLockState("suzuki", db, T0).locked, true);
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, afterLock(T0)));
    assert.deepEqual(getLockNotice(token, db, afterLock(T0)), { count: 1, lastLockedAt: T0.toISOString() });
  });

  it("期限切れ・不明なトークンでは読めない", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, afterLock(T0)));
    assert.equal(getLockNotice(undefined, db, afterLock(T0)), undefined);
    assert.equal(getLockNotice("unknown", db, afterLock(T0)), undefined);
    assert.equal(getLockNotice(token, db, new Date("2099-01-01T00:00:00Z")), undefined);
  });
});

describe("ロックの方針は変えない", () => {
  it("5 回で 15 分ロックし、ロック中の試行で延びない", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    fail(db, "suzuki", 3, at(10));
    assert.deepEqual(getLockState("suzuki", db, at(10)), { locked: true, retryAfterMinutes: 5 });
    assert.deepEqual(getLockState("suzuki", db, afterLock(T0)), { locked: false });
    assert.equal(LOCK_MS, 15 * 60_000);
    assert.equal(MAX_FAILURES, 5);
  });
});

describe("GET /api/me のロックの知らせ", () => {
  it("ロックされていれば count と lastLockedAt を返し、無ければ null", () => {
    const db = openDb();
    fail(db, "suzuki", MAX_FAILURES, T0);
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, afterLock(T0)));
    const user = { id: "suzuki", name: "鈴木" };
    const body = toMeResponse(user, null, getLockNotice(token, db, afterLock(T0)) ?? null);
    assert.deepEqual(body.lockNotice, { count: 1, lastLockedAt: T0.toISOString() });
    assert.equal(toMeResponse(user).lockNotice, null);
  });

  it("決めた項目だけを詰め直す", () => {
    const leaky = { count: 1, lastLockedAt: T0.toISOString(), token: "secret" };
    const body = toMeResponse({ id: "suzuki", name: "鈴木" }, null, leaky);
    assert.ok(!JSON.stringify(body).includes("secret"));
  });
});

describe("マイグレーション", () => {
  it("既存の利用者・セッションは 0 から始まり、知らせない", () => {
    const db = new DatabaseSync(":memory:");
    const before = MIGRATIONS.filter((m) => m.version < 27);
    for (const m of before) db.exec(m.sql);
    db.exec(`PRAGMA user_version = ${before.at(-1)!.version}`);
    db.exec("INSERT INTO users (id, name) VALUES ('suzuki', '鈴木')");
    db.exec(
      "INSERT INTO sessions (token, user_id, expires_at, device_id) VALUES ('t', 'suzuki', '2099-01-01T00:00:00.000Z', 'd')",
    );
    migrate(db);
    assert.equal(getLockNotice("t", db, T0), null);
    const row = db.prepare("SELECT locks_since_login AS n, last_locked_at AS at FROM users WHERE id = 'suzuki'").get() as {
      n: number;
      at: string | null;
    };
    assert.deepEqual({ ...row }, { n: 0, at: null });
  });
});
