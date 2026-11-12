// 前回のログイン日時の記録と表示（#313）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  SESSION_TTL_MS,
  createSession,
  formatPreviousLogin,
  getPreviousLogin,
  login,
} from "../src/lib/auth.ts";
import { migrate, openDb, type Db } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { MAX_FAILURES } from "../src/lib/login-throttle.ts";
import { listUsers } from "../src/lib/users.ts";

function lastLoginAt(db: Db, userId: string): string | null {
  return (db.prepare("SELECT last_login_at FROM users WHERE id = ?").get(userId) as { last_login_at: string | null })
    .last_login_at;
}

function tokenOf(result: ReturnType<typeof login>): string {
  assert.equal(result.ok, true);
  return (result as { token: string }).token;
}

const T1 = new Date("2026-11-12T09:05:00.000Z");
const T2 = new Date("2026-11-13T01:30:00.000Z");
const T3 = new Date("2026-11-14T02:00:00.000Z");

describe("ログインの記録", () => {
  it("ログインに成功すると、その利用者の最終ログイン日時が ISO 8601（UTC）で記録される", () => {
    const db = openDb();
    const result = login("sato", SEED_PASSWORD, db, T1);
    assert.equal(result.ok, true);
    assert.equal(lastLoginAt(db, "sato"), "2026-11-12T09:05:00.000Z");
    assert.equal(lastLoginAt(db, "suzuki"), null);
  });

  it("パスワード違いでは記録されず、セッションも作られない", () => {
    const db = openDb();
    login("sato", SEED_PASSWORD, db, T1);
    assert.deepEqual(login("sato", "wrong", db, T2), { ok: false, reason: "invalid" });
    assert.equal(lastLoginAt(db, "sato"), T1.toISOString());
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    assert.equal(n, 1);
  });

  it("存在しない ID・文字列でない入力では記録されない", () => {
    const db = openDb();
    assert.deepEqual(login("nobody", SEED_PASSWORD, db, T1), { ok: false, reason: "invalid" });
    assert.deepEqual(login("sato", undefined, db, T1), { ok: false, reason: "invalid" });
    assert.deepEqual(login(undefined, SEED_PASSWORD, db, T1), { ok: false, reason: "invalid" });
    assert.equal(lastLoginAt(db, "sato"), null);
  });

  it("ロック中は、パスワードが正しくても記録されない", () => {
    const db = openDb();
    for (let i = 0; i < MAX_FAILURES; i++) login("sato", "wrong", db, T1);
    const result = login("sato", SEED_PASSWORD, db, T1);
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "locked");
    assert.equal(lastLoginAt(db, "sato"), null);
  });

  it("成功したら失敗の回数を消す（これまでどおり）", () => {
    const db = openDb();
    for (let i = 0; i < MAX_FAILURES - 1; i++) login("sato", "wrong", db, T1);
    assert.equal(login("sato", SEED_PASSWORD, db, T1).ok, true);
    login("sato", "wrong", db, T1);
    assert.equal(login("sato", SEED_PASSWORD, db, T1).ok, true);
  });

  it("セッションを作れなければ、最終ログイン日時も変わらない（全部か無しか）", () => {
    const db = openDb();
    login("sato", SEED_PASSWORD, db, T1);
    db.exec(
      "CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'session insert failed'); END",
    );
    assert.throws(() => login("sato", SEED_PASSWORD, db, T2));
    assert.equal(lastLoginAt(db, "sato"), T1.toISOString());
  });
});

describe("前回のログイン", () => {
  it("初めてログインした人は「なし」", () => {
    const db = openDb();
    const token = tokenOf(login("sato", SEED_PASSWORD, db, T1));
    assert.equal(getPreviousLogin(token, db, T1), null);
    assert.equal(formatPreviousLogin(getPreviousLogin(token, db, T1) ?? null), "前回のログイン: なし");
  });

  it("今回ではなく、1 つ前のログインの日時が出る", () => {
    const db = openDb();
    login("sato", SEED_PASSWORD, db, T1);
    const token = tokenOf(login("sato", SEED_PASSWORD, db, T2));
    assert.equal(getPreviousLogin(token, db, T2), T1.toISOString());
    assert.equal(lastLoginAt(db, "sato"), T2.toISOString());
  });

  it("失敗したログインは「前回」に数えない", () => {
    const db = openDb();
    login("sato", SEED_PASSWORD, db, T1);
    login("sato", "wrong", db, T2);
    const token = tokenOf(login("sato", SEED_PASSWORD, db, T3));
    assert.equal(getPreviousLogin(token, db, T3), T1.toISOString());
  });

  it("別の端末で後からログインしても、今の端末の「前回」は変わらない", () => {
    const db = openDb();
    login("sato", SEED_PASSWORD, db, T1);
    const first = tokenOf(login("sato", SEED_PASSWORD, db, T2));
    const second = tokenOf(login("sato", SEED_PASSWORD, db, T3));
    assert.equal(getPreviousLogin(first, db, T3), T1.toISOString());
    assert.equal(getPreviousLogin(second, db, T3), T2.toISOString());
  });

  it("ほかの利用者のログインは、自分の「前回」に影響せず、利用者の一覧にも最終ログイン日時は出ない", () => {
    const db = openDb();
    const sato = tokenOf(login("sato", SEED_PASSWORD, db, T1));
    login("suzuki", SEED_PASSWORD, db, T2);
    login("suzuki", SEED_PASSWORD, db, T3);
    assert.equal(getPreviousLogin(sato, db, T3), null);
    for (const u of listUsers(db)) assert.deepEqual(Object.keys(u).sort(), ["id", "name"]);
  });

  it("期限切れ・不明なセッションでは返さない", () => {
    const db = openDb();
    login("sato", SEED_PASSWORD, db, T1);
    const token = tokenOf(login("sato", SEED_PASSWORD, db, T2));
    assert.equal(getPreviousLogin(token, db, new Date(T2.getTime() + SESSION_TTL_MS)), undefined);
    assert.equal(getPreviousLogin("unknown", db, T2), undefined);
    assert.equal(getPreviousLogin(undefined, db, T2), undefined);
  });

  it("日本時間の「YYYY/MM/DD HH:mm」で出す（UTC で前日でも日本時間の日付）", () => {
    assert.equal(formatPreviousLogin("2026-11-12T09:05:00.000Z"), "前回のログイン: 2026/11/12 18:05");
    assert.equal(formatPreviousLogin("2026-12-31T15:00:00.000Z"), "前回のログイン: 2027/01/01 00:00");
    assert.equal(formatPreviousLogin("2026-01-05T14:59:00.000Z"), "前回のログイン: 2026/01/05 23:59");
    assert.equal(formatPreviousLogin(null), "前回のログイン: なし");
  });

  it("これまでのセッション（ログインを通さず作ったもの）は「なし」", () => {
    const db = openDb();
    const token = createSession("sato", db, T1);
    assert.equal(getPreviousLogin(token, db, T1), null);
  });
});

describe("マイグレーション", () => {
  it("既存の利用者は、マイグレーション後「なし」から始まる", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, MIGRATIONS.filter((m) => m.version < 14));
    db.prepare("INSERT INTO users (id, name, password_hash) VALUES ('sato', '佐藤', '')").run();
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES ('t', 'sato', '2099-01-01T00:00:00.000Z')").run();
    migrate(db);
    assert.equal(lastLoginAt(db, "sato"), null);
    assert.equal(getPreviousLogin("t", db, T1), null);
  });
});
