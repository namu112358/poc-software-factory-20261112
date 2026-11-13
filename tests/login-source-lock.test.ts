// ほかの人が ID だけで本人をログインから締め出せないよう、失敗を「ID と接続元の組」とアカウント全体で数える（#526）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { changePassword, createSession, formatLockNotice, getLockNotice, login } from "../src/lib/auth.ts";
import { migrate, openDb, type Db } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { loginErrorPath } from "../src/lib/login-error.ts";
import { loginSourceFromForwardedFor, loginSourceFromHeaders } from "../src/lib/login-source.ts";
import {
  ACCOUNT_MAX_FAILURES,
  ACCOUNT_WINDOW_MS,
  LOCK_MS,
  MAX_FAILURES,
  getLockState,
} from "../src/lib/login-throttle.ts";
import { suspendUser } from "../src/lib/users.ts";

const T0 = new Date("2026-11-13T01:50:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const A = "192.0.2.1";
const B = "198.51.100.2";

type Result = ReturnType<typeof login>;

function failFrom(db: Db, userId: string, source: string | null, times: number, now = T0): Result[] {
  const results: Result[] = [];
  for (let i = 0; i < times; i++) results.push(login(userId, "wrong-password", db, now, null, source));
  return results;
}

/** 接続元を 1 つずつ替えながら、組のロックにかからない回数で誤る（接続元をまたいだ総当たり）。 */
function failAcrossSources(db: Db, userId: string, times: number, now = T0): Result[] {
  const results: Result[] = [];
  for (let i = 0; i < times; i++) {
    const source = `203.0.113.${Math.floor(i / (MAX_FAILURES - 1)) + 1}`;
    results.push(login(userId, "wrong-password", db, now, null, source));
  }
  return results;
}

const reasonOf = (r: Result) => (r.ok ? "ok" : r.reason);

describe("組ごとのロック", () => {
  it("接続元 A から 5 回誤ると、A からのログインは 15 分ロックされ、あと何分かを返す（429 の元）", () => {
    const db = openDb();
    const results = failFrom(db, "suzuki", A, MAX_FAILURES);
    assert.deepEqual(results.at(-1), { ok: false, reason: "lock-started", retryAfterMinutes: 15 });
    assert.deepEqual(login("suzuki", SEED_PASSWORD, db, at(1), null, A), {
      ok: false,
      reason: "locked",
      retryAfterMinutes: 14,
    });
    assert.equal(loginErrorPath({ reason: "locked", retryAfterMinutes: 14 }), "/login?error=locked&minutes=14");
  });

  it("4 回まではロックしない", () => {
    const db = openDb();
    assert.deepEqual(failFrom(db, "suzuki", A, MAX_FAILURES - 1).map(reasonOf), ["invalid", "invalid", "invalid", "invalid"]);
    assert.equal(login("suzuki", SEED_PASSWORD, db, T0, null, A).ok, true);
  });

  it("A がロックされているあいだも、接続元 B からは正しいパスワードでログインできる", () => {
    const db = openDb();
    failFrom(db, "suzuki", A, MAX_FAILURES);
    assert.equal(login("suzuki", SEED_PASSWORD, db, at(1), null, B).ok, true);
    // B でログインしても A のロックは残る
    assert.equal(reasonOf(login("suzuki", SEED_PASSWORD, db, at(2), null, A)), "locked");
  });

  it("接続元の分からない試行は 1 つの組（ID ごと）に数え、IP の分かる接続元はその影響を受けない", () => {
    const db = openDb();
    failFrom(db, "suzuki", null, MAX_FAILURES);
    assert.equal(reasonOf(login("suzuki", SEED_PASSWORD, db, at(1), null, null)), "locked");
    assert.equal(login("suzuki", SEED_PASSWORD, db, at(1), null, B).ok, true);
  });

  it("15 分ちょうどで明け、明けたあとは 1 回目から数え直す", () => {
    const db = openDb();
    failFrom(db, "suzuki", A, MAX_FAILURES);
    const after = new Date(T0.getTime() + LOCK_MS);
    assert.deepEqual(getLockState("suzuki", db, new Date(after.getTime() - 1), A), { locked: true, retryAfterMinutes: 1 });
    assert.deepEqual(getLockState("suzuki", db, after, A), { locked: false });
    assert.deepEqual(failFrom(db, "suzuki", A, MAX_FAILURES - 1, after).map(reasonOf), ["invalid", "invalid", "invalid", "invalid"]);
  });

  it("ロック中の試行は数えず、ロックを延ばさない", () => {
    const db = openDb();
    failFrom(db, "suzuki", A, MAX_FAILURES);
    failFrom(db, "suzuki", A, 20, at(5));
    assert.equal(login("suzuki", SEED_PASSWORD, db, new Date(T0.getTime() + LOCK_MS), null, A).ok, true);
  });
});

describe("成功で組の数が 0 に戻る", () => {
  it("A で 4 回誤ったあと A で成功すると、A の数は 0 に戻る", () => {
    const db = openDb();
    failFrom(db, "suzuki", A, MAX_FAILURES - 1);
    assert.equal(login("suzuki", SEED_PASSWORD, db, at(1), null, A).ok, true);
    assert.deepEqual(failFrom(db, "suzuki", A, MAX_FAILURES - 1, at(2)).map(reasonOf), ["invalid", "invalid", "invalid", "invalid"]);
  });

  it("B での成功は A の数を戻さない（組ごとに数える）", () => {
    const db = openDb();
    failFrom(db, "suzuki", A, MAX_FAILURES - 1);
    assert.equal(login("suzuki", SEED_PASSWORD, db, at(1), null, B).ok, true);
    assert.equal(reasonOf(failFrom(db, "suzuki", A, 1, at(2))[0]), "lock-started");
  });
});

describe("アカウント全体のロック", () => {
  it("接続元をまたいで 1 時間に 30 回誤ると、アカウント全体が 15 分ロックされ、どの接続元からも locked になる", () => {
    const db = openDb();
    const results = failAcrossSources(db, "suzuki", ACCOUNT_MAX_FAILURES);
    assert.deepEqual(
      results.slice(0, -1).map(reasonOf),
      Array(ACCOUNT_MAX_FAILURES - 1).fill("invalid"),
    );
    assert.deepEqual(results.at(-1), { ok: false, reason: "lock-started", retryAfterMinutes: 15 });
    for (const source of [A, B, null, "203.0.113.1"]) {
      assert.deepEqual(login("suzuki", SEED_PASSWORD, db, at(1), null, source), {
        ok: false,
        reason: "locked",
        retryAfterMinutes: 14,
      });
    }
    // ほかの ID には効かない
    assert.equal(login("sato", SEED_PASSWORD, db, at(1), null, A).ok, true);
  });

  it("1 時間より前の失敗は数えない", () => {
    const db = openDb();
    failAcrossSources(db, "suzuki", ACCOUNT_MAX_FAILURES - 1, T0);
    const later = new Date(T0.getTime() + ACCOUNT_WINDOW_MS);
    assert.equal(reasonOf(login("suzuki", "wrong-password", db, later, null, B)), "invalid");
    assert.equal(login("suzuki", SEED_PASSWORD, db, later, null, B).ok, true);
  });

  it("1 時間ちょうどの手前なら数える", () => {
    const db = openDb();
    failAcrossSources(db, "suzuki", ACCOUNT_MAX_FAILURES - 1, T0);
    const justBefore = new Date(T0.getTime() + ACCOUNT_WINDOW_MS - 1);
    assert.equal(reasonOf(login("suzuki", "wrong-password", db, justBefore, null, B)), "lock-started");
  });

  it("1 つの接続元だけでは、組のロックで止まり、1 時間に 30 回に届かない", () => {
    const db = openDb();
    for (let m = 0; m < 60; m++) failFrom(db, "suzuki", A, 1, at(m));
    assert.equal(login("suzuki", SEED_PASSWORD, db, at(60), null, B).ok, true);
  });

  it("組がロック中でも、ほかの接続元の誤りで全体の数は進み、組のロックが明けても全体のロック中は locked", () => {
    const db = openDb();
    failFrom(db, "suzuki", A, MAX_FAILURES, T0);
    failAcrossSources(db, "suzuki", ACCOUNT_MAX_FAILURES - MAX_FAILURES, at(10));
    // 組 A のロックは T0+15 分で明けるが、全体のロックは T0+10 分から 15 分
    const r = login("suzuki", SEED_PASSWORD, db, at(16), null, A);
    assert.deepEqual(r, { ok: false, reason: "locked", retryAfterMinutes: 9 });
  });

  it("組と全体の両方がロック中なら、長く残るほうの分を返す", () => {
    const db = openDb();
    failAcrossSources(db, "suzuki", ACCOUNT_MAX_FAILURES, T0); // 全体: T0+15 分まで
    // 全体のロックが明けたあと、A で組のロック（at(20) から 15 分）
    failFrom(db, "suzuki", A, MAX_FAILURES, at(20));
    assert.deepEqual(getLockState("suzuki", db, at(21), A), { locked: true, retryAfterMinutes: 14 });
  });

  it("15 分で明け、明けたあとは全体の数を 0 から数える", () => {
    const db = openDb();
    failAcrossSources(db, "suzuki", ACCOUNT_MAX_FAILURES, T0);
    const after = new Date(T0.getTime() + LOCK_MS);
    assert.deepEqual(getLockState("suzuki", db, after, B), { locked: false });
    // 明けた直後に別の接続元から 1 回誤っても、すぐにはロックされない
    assert.equal(reasonOf(login("suzuki", "wrong-password", db, after, null, B)), "invalid");
  });

  it("ロックが明けたあと鈴木がログインすると、ロックされたことが知らされる（#479 の知らせ）", () => {
    const db = openDb();
    failAcrossSources(db, "suzuki", ACCOUNT_MAX_FAILURES, T0);
    const result = login("suzuki", SEED_PASSWORD, db, new Date(T0.getTime() + LOCK_MS), null, B);
    assert.equal(result.ok, true);
    const notice = getLockNotice((result as { token: string }).token, db, at(16));
    assert.deepEqual(notice, { count: 1, lastLockedAt: T0.toISOString() });
    assert.equal(formatLockNotice(notice), "前回のログインのあと、ログインが 1 回ロックされました（最後は 2026/11/13 10:50）");
  });

  it("組のロックも、ロックされた回数として知らせる（今の振る舞いを保つ）", () => {
    const db = openDb();
    failFrom(db, "suzuki", A, MAX_FAILURES, T0);
    const result = login("suzuki", SEED_PASSWORD, db, at(1), null, B);
    assert.deepEqual(getLockNotice((result as { token: string }).token, db, at(1)), { count: 1, lastLockedAt: T0.toISOString() });
  });
});

describe("存在しない ID", () => {
  it("組のロックとアカウント全体のロックで、応答の状態と文言の元が存在する ID と同じ", () => {
    const db = openDb();
    assert.deepEqual(failFrom(db, "nobody", A, MAX_FAILURES).map((r) => r), failFrom(db, "suzuki", A, MAX_FAILURES));
    assert.deepEqual(login("nobody", "x", db, at(1), null, A), login("suzuki", "x", db, at(1), null, A));
    assert.deepEqual(login("nobody", "x", db, at(1), null, B), login("suzuki", "wrong-password", db, at(1), null, B));

    const db2 = openDb();
    assert.deepEqual(failAcrossSources(db2, "nobody", ACCOUNT_MAX_FAILURES), failAcrossSources(db2, "suzuki", ACCOUNT_MAX_FAILURES));
    assert.deepEqual(login("nobody", "x", db2, at(1), null, B), login("suzuki", "x", db2, at(1), null, B));
  });
});

describe("接続元の見分け方", () => {
  it("X-Forwarded-For のいちばん右の IP アドレスを使う", () => {
    assert.equal(loginSourceFromForwardedFor("192.0.2.1"), "192.0.2.1");
    assert.equal(loginSourceFromForwardedFor("10.0.0.1, 192.0.2.1"), "192.0.2.1");
    assert.equal(loginSourceFromForwardedFor(" 10.0.0.1 ,  2001:DB8::1 "), "2001:db8::1");
    assert.equal(loginSourceFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.2" })), "198.51.100.2");
  });

  it("IPv4 を IPv6 の形で表した値は IPv4 にそろえる", () => {
    assert.equal(loginSourceFromForwardedFor("::ffff:192.0.2.1"), "192.0.2.1");
    assert.equal(loginSourceFromForwardedFor("::FFFF:192.0.2.1"), "192.0.2.1");
  });

  it("無い・空・IP アドレスでない・長すぎる値は見分けられない（null）として、ID ごとに数える", () => {
    for (const v of [null, undefined, "", " ", "1.2.3.4,", "unknown", "example.com", "999.1.1.1", "1".repeat(65), "192.0.2.1:8080"]) {
      assert.equal(loginSourceFromForwardedFor(v), null, String(v));
    }
    assert.equal(loginSourceFromHeaders(new Headers()), null);
  });
});

describe("ほかの入口", () => {
  it("パスワード変更の誤りは全体の数に入り、全体のロック中は変更できない", () => {
    const db = openDb();
    const token = createSession("suzuki", db, T0);
    failAcrossSources(db, "suzuki", ACCOUNT_MAX_FAILURES - 1, T0);
    const input = { currentPassword: "wrong-password", newPassword: "new-password-123" };
    assert.deepEqual(changePassword("suzuki", token, input, db, T0), { ok: false, reason: "wrong-password" });
    assert.deepEqual(
      changePassword("suzuki", token, { currentPassword: SEED_PASSWORD, newPassword: "new-password-123" }, db, at(1)),
      { ok: false, reason: "locked", retryAfterMinutes: 14 },
    );
  });

  it("ある接続元の組がロックされていても、パスワード変更は今のパスワードが正しければできる", () => {
    const db = openDb();
    const token = createSession("suzuki", db, T0);
    failFrom(db, "suzuki", A, MAX_FAILURES);
    assert.deepEqual(
      changePassword("suzuki", token, { currentPassword: SEED_PASSWORD, newPassword: "new-password-123" }, db, at(1)),
      { ok: true },
    );
  });

  it("ログインを停止した利用者は、ロックの数え方に関わらずログインできず、応答は誤りと同じ", () => {
    const db = openDb();
    assert.equal(suspendUser("tanaka", "suzuki", db, T0).ok, true);
    assert.deepEqual(login("suzuki", SEED_PASSWORD, db, T0, null, A), { ok: false, reason: "invalid" });
    assert.deepEqual(login("suzuki", SEED_PASSWORD, db, T0, null, B), { ok: false, reason: "invalid" });
  });

  it("ID が文字列でないときは数えない", () => {
    const db = openDb();
    for (let i = 0; i < ACCOUNT_MAX_FAILURES; i++) login(123, "x", db, T0, null, A);
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM login_failure_log").get() as { n: number };
    assert.equal(n, 0);
  });
});

describe("マイグレーション", () => {
  it("既存の ID ごとの失敗の数とロックは、接続元の分からない組として引き継ぐ", () => {
    const db = new DatabaseSync(":memory:");
    const before = MIGRATIONS.filter((m) => m.version < 29);
    for (const m of before) db.exec(m.sql);
    db.exec(`PRAGMA user_version = ${before.at(-1)!.version}`);
    const until = at(10).toISOString();
    db.prepare("INSERT INTO login_attempts (user_id, failures, locked_until) VALUES (?, ?, ?)").run("suzuki", 5, until);
    db.prepare("INSERT INTO login_attempts (user_id, failures, locked_until) VALUES (?, ?, NULL)").run("sato", 3);
    migrate(db);
    assert.deepEqual(getLockState("suzuki", db, T0, null), { locked: true, retryAfterMinutes: 10 });
    assert.deepEqual(getLockState("suzuki", db, T0, A), { locked: false });
    const row = db.prepare("SELECT source, failures FROM login_attempts WHERE user_id = 'sato'").get() as {
      source: string;
      failures: number;
    };
    assert.deepEqual({ ...row }, { source: "", failures: 3 });
  });
});
