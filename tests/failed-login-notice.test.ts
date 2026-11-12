// 前回のログインのあとに、自分の ID でパスワードを誤ったログインの回数を、ログイン後に知らせる（#349）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  SESSION_TTL_MS,
  changePassword,
  createSession,
  formatFailedLoginNotice,
  getFailedLoginsBefore,
  login,
} from "../src/lib/auth.ts";
import { migrate, openDb, type Db } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { LOCK_MS, MAX_FAILURES, getLockState } from "../src/lib/login-throttle.ts";

const T0 = new Date("2026-11-12T09:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function tokenOf(result: ReturnType<typeof login>): string {
  assert.equal(result.ok, true);
  return (result as { token: string }).token;
}

function counter(db: Db, userId: string): number {
  return (
    db.prepare("SELECT failed_logins_since_login AS n FROM users WHERE id = ?").get(userId) as { n: number }
  ).n;
}

function fail(db: Db, userId: string, times: number, now = T0): void {
  for (let i = 0; i < times; i++) login(userId, "wrong-password", db, now);
}

describe("ログイン後に知らせる、パスワードを誤ったログインの回数", () => {
  it("前回のログインのあとに N 回誤ると、次のログインのセッションは N を持つ", () => {
    const db = openDb();
    tokenOf(login("sato", SEED_PASSWORD, db, T0));
    fail(db, "sato", 3, at(1));
    const token = tokenOf(login("sato", SEED_PASSWORD, db, at(2)));
    assert.equal(getFailedLoginsBefore(token, db, at(2)), 3);
  });

  it("その間に誤りが無ければ 0 で、知らせは出ない", () => {
    const db = openDb();
    tokenOf(login("sato", SEED_PASSWORD, db, T0));
    const token = tokenOf(login("sato", SEED_PASSWORD, db, at(1)));
    assert.equal(getFailedLoginsBefore(token, db, at(1)), 0);
    assert.equal(formatFailedLoginNotice(0), undefined);
  });

  it("次のログインでは 0 から数え直し、前の分を 2 度知らせない", () => {
    const db = openDb();
    fail(db, "sato", 2, T0);
    const first = tokenOf(login("sato", SEED_PASSWORD, db, at(1)));
    assert.equal(getFailedLoginsBefore(first, db, at(1)), 2);
    assert.equal(counter(db, "sato"), 0);
    const second = tokenOf(login("sato", SEED_PASSWORD, db, at(2)));
    assert.equal(getFailedLoginsBefore(second, db, at(2)), 0);
    fail(db, "sato", 1, at(3));
    const third = tokenOf(login("sato", SEED_PASSWORD, db, at(4)));
    assert.equal(getFailedLoginsBefore(third, db, at(4)), 1);
  });

  it("初めてのログインの前の失敗も、その回数として持つ", () => {
    const db = openDb();
    fail(db, "suzuki", 2, T0);
    const token = tokenOf(login("suzuki", SEED_PASSWORD, db, at(1)));
    assert.equal(getFailedLoginsBefore(token, db, at(1)), 2);
  });

  it("ロックの間に試されて照合されなかったログインも数える（正しいパスワードでの試行を含む）", () => {
    const db = openDb();
    fail(db, "sato", MAX_FAILURES, T0);
    assert.equal(getLockState("sato", db, at(1)).locked, true);
    assert.equal(login("sato", "wrong-password", db, at(1)).ok, false);
    assert.equal(login("sato", SEED_PASSWORD, db, at(2)).ok, false);
    const token = tokenOf(login("sato", SEED_PASSWORD, db, new Date(T0.getTime() + LOCK_MS)));
    assert.equal(getFailedLoginsBefore(token, db, new Date(T0.getTime() + LOCK_MS)), MAX_FAILURES + 2);
  });

  it("ほかの利用者の ID への失敗は数えない", () => {
    const db = openDb();
    fail(db, "suzuki", 4, T0);
    const token = tokenOf(login("sato", SEED_PASSWORD, db, at(1)));
    assert.equal(getFailedLoginsBefore(token, db, at(1)), 0);
    assert.equal(counter(db, "suzuki"), 4);
  });

  it("存在しない ID・空の ID・文字列でない ID への失敗は、どの利用者の回数にも入らない", () => {
    const db = openDb();
    fail(db, "nobody", 3, T0);
    fail(db, "", 1, T0);
    fail(db, "SATO", 1, T0);
    assert.equal(login(undefined, "x", db, T0).ok, false);
    assert.equal(login(123, "x", db, T0).ok, false);
    const total = (db.prepare("SELECT SUM(failed_logins_since_login) AS n FROM users").get() as { n: number }).n;
    assert.equal(total, 0);
  });

  it("パスワードが文字列でない誤ったログインも、その ID の回数に数える", () => {
    const db = openDb();
    assert.equal(login("sato", undefined, db, T0).ok, false);
    assert.equal(counter(db, "sato"), 1);
  });

  it("回数はログインした時点で決まり、ログイン中にほかの端末で失敗があっても変わらない", () => {
    const db = openDb();
    fail(db, "sato", 1, T0);
    const token = tokenOf(login("sato", SEED_PASSWORD, db, at(1)));
    fail(db, "sato", 2, at(2));
    assert.equal(getFailedLoginsBefore(token, db, at(3)), 1);
    // ログイン中の失敗は、次のログインで知らせる。
    const next = tokenOf(login("sato", SEED_PASSWORD, db, at(4)));
    assert.equal(getFailedLoginsBefore(next, db, at(4)), 2);
    assert.equal(getFailedLoginsBefore(token, db, at(4)), 1);
  });

  it("パスワード変更の画面で今のパスワードを誤っても、ログインの失敗としては数えない", () => {
    const db = openDb();
    const token = tokenOf(login("sato", SEED_PASSWORD, db, T0));
    const result = changePassword("sato", token, { currentPassword: "wrong", newPassword: "new-password-1" }, db, at(1));
    assert.deepEqual(result, { ok: false, reason: "wrong-password" });
    assert.equal(counter(db, "sato"), 0);
  });
});

describe("回数を読めるのは本人の有効なセッションだけ", () => {
  it("トークンが無い・不明・期限切れなら読めない", () => {
    const db = openDb();
    fail(db, "sato", 2, T0);
    const token = tokenOf(login("sato", SEED_PASSWORD, db, T0));
    assert.equal(getFailedLoginsBefore(undefined, db, T0), undefined);
    assert.equal(getFailedLoginsBefore("unknown", db, T0), undefined);
    assert.equal(getFailedLoginsBefore(token, db, new Date(T0.getTime() + SESSION_TTL_MS)), undefined);
  });

  it("ほかの利用者のセッションには、自分の回数は出ない", () => {
    const db = openDb();
    fail(db, "sato", 2, T0);
    const suzuki = tokenOf(login("suzuki", SEED_PASSWORD, db, at(1)));
    const sato = tokenOf(login("sato", SEED_PASSWORD, db, at(1)));
    assert.equal(getFailedLoginsBefore(suzuki, db, at(1)), 0);
    assert.equal(getFailedLoginsBefore(sato, db, at(1)), 2);
  });

  it("ログインを通さずに作ったセッションは 0 を持つ", () => {
    const db = openDb();
    const token = createSession("sato", db, T0);
    assert.equal(getFailedLoginsBefore(token, db, T0), 0);
  });
});

describe("ロックの振る舞いは変わらない", () => {
  it("続けて MAX_FAILURES 回誤るとロックされ、ロック中は正しいパスワードでもログインできない", () => {
    const db = openDb();
    fail(db, "sato", MAX_FAILURES - 1, T0);
    assert.equal(getLockState("sato", db, T0).locked, false);
    fail(db, "sato", 1, T0);
    assert.deepEqual(login("sato", SEED_PASSWORD, db, at(1)), { ok: false, reason: "locked", retryAfterMinutes: 14 });
  });

  it("ロック中の試行でロックは延びず、時間が過ぎればログインでき、ロックの回数は消える", () => {
    const db = openDb();
    fail(db, "sato", MAX_FAILURES, T0);
    fail(db, "sato", 3, at(5));
    const after = new Date(T0.getTime() + LOCK_MS);
    assert.equal(login("sato", SEED_PASSWORD, db, after).ok, true);
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM login_attempts").get() as { n: number };
    assert.equal(n, 0);
  });

  it("存在しない ID への失敗も、これまでどおりロックの回数に数える", () => {
    const db = openDb();
    fail(db, "nobody", MAX_FAILURES, T0);
    assert.equal(login("nobody", "x", db, at(1)).ok, false);
    assert.equal((login("nobody", "x", db, at(1)) as { reason: string }).reason, "locked");
  });
});

describe("知らせの文言", () => {
  it("1 回以上なら回数を入れた文言、0 回・不明なら出さない", () => {
    assert.equal(formatFailedLoginNotice(1), "前回のログインのあと、パスワードを誤ったログインが 1 回ありました");
    assert.equal(formatFailedLoginNotice(12), "前回のログインのあと、パスワードを誤ったログインが 12 回ありました");
    assert.equal(formatFailedLoginNotice(0), undefined);
    assert.equal(formatFailedLoginNotice(undefined), undefined);
  });
});

describe("マイグレーション", () => {
  it("既存の利用者・セッションは 0 から始まる", () => {
    const db = new DatabaseSync(":memory:");
    const before = MIGRATIONS.filter((m) => m.version < 17);
    for (const m of before) db.exec(m.sql);
    db.exec(`PRAGMA user_version = ${before.at(-1)!.version}`);
    db.exec("INSERT INTO users (id, name) VALUES ('sato', '佐藤')");
    db.exec(
      "INSERT INTO sessions (token, user_id, expires_at, device_id) VALUES ('t', 'sato', '2099-01-01T00:00:00.000Z', 'd')",
    );
    migrate(db);
    assert.equal(counter(db, "sato"), 0);
    assert.equal(getFailedLoginsBefore("t", db, T0), 0);
  });
});
