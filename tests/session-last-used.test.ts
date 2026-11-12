// ログイン中の端末の一覧の「最後に使った日時」（#397）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  LAST_USED_UPDATE_INTERVAL_MS,
  SESSION_TTL_MS,
  createSession,
  getLoginWindow,
  getPreviousLogin,
  getSessionUserAndTouch,
  login,
  touchSession,
} from "../src/lib/auth.ts";
import { migrate, openDb, type Db } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { formatLastUsedAt, listDeviceSessions, revokeDeviceSession } from "../src/lib/device-sessions.ts";

const LOGIN_AT = new Date("2026-11-10T09:00:00.000Z");
const ms = (base: Date, delta: number) => new Date(base.getTime() + delta);

function lastUsedOf(db: Db, token: string): string | null {
  return (db.prepare("SELECT last_used_at FROM sessions WHERE token = ?").get(token) as { last_used_at: string | null })
    .last_used_at;
}

function loginToken(db: Db, userId: string, at: Date): string {
  const result = login(userId, SEED_PASSWORD, db, at, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0.0.0 Safari/537.36");
  assert.equal(result.ok, true);
  return (result as { token: string }).token;
}

describe("最後に使った日時の記録", () => {
  it("ログインした直後は、最後に使った日時がログインした日時と同じ", () => {
    const db = openDb();
    const token = loginToken(db, "sato", LOGIN_AT);
    const [row] = listDeviceSessions(token, db, LOGIN_AT)!;
    assert.equal(row.lastUsedAt, LOGIN_AT.toISOString());
    assert.equal(row.lastUsedAt, row.loggedInAt);
  });

  it("その端末で画面や API を使う（ログインを確かめる）と、最後に使った日時が更新される", () => {
    const db = openDb();
    const token = loginToken(db, "sato", LOGIN_AT);
    const later = ms(LOGIN_AT, 60 * 60 * 1000);
    assert.equal(getSessionUserAndTouch(token, db, later)?.id, "sato");
    assert.equal(lastUsedOf(db, token), later.toISOString());
  });

  it("端末の一覧を見る・端末を切る API も利用として更新される", () => {
    const db = openDb();
    const token = loginToken(db, "sato", LOGIN_AT);
    const t1 = ms(LOGIN_AT, 10 * 60 * 1000);
    const [row] = listDeviceSessions(token, db, t1)!;
    assert.equal(row.lastUsedAt, t1.toISOString());
    const t2 = ms(t1, 10 * 60 * 1000);
    revokeDeviceSession(token, "0".repeat(32), db, t2);
    assert.equal(lastUsedOf(db, token), t2.toISOString());
  });

  it("前の更新から 5 分以内（5 分ちょうどを含む）では更新せず、5 分を過ぎたら更新する", () => {
    const db = openDb();
    const token = loginToken(db, "sato", LOGIN_AT);
    assert.equal(touchSession(token, db, ms(LOGIN_AT, 1)), false);
    assert.equal(touchSession(token, db, ms(LOGIN_AT, LAST_USED_UPDATE_INTERVAL_MS - 1)), false);
    assert.equal(touchSession(token, db, ms(LOGIN_AT, LAST_USED_UPDATE_INTERVAL_MS)), false);
    assert.equal(lastUsedOf(db, token), LOGIN_AT.toISOString());
    const after = ms(LOGIN_AT, LAST_USED_UPDATE_INTERVAL_MS + 1);
    assert.equal(touchSession(token, db, after), true);
    assert.equal(lastUsedOf(db, token), after.toISOString());
    // 次の判定は、更新した時点から数える。
    assert.equal(touchSession(token, db, ms(after, LAST_USED_UPDATE_INTERVAL_MS)), false);
    assert.equal(touchSession(token, db, ms(after, LAST_USED_UPDATE_INTERVAL_MS + 1)), true);
  });

  it("前の値が今より後（時計のずれ）でも、日時を過去に戻さない", () => {
    const db = openDb();
    const future = ms(LOGIN_AT, 60 * 60 * 1000);
    const token = createSession("sato", db, future);
    assert.equal(touchSession(token, db, LOGIN_AT), false);
    assert.equal(lastUsedOf(db, token), future.toISOString());
  });

  it("ほかの端末・ほかの利用者の利用で、別の端末の日時は変わらない", () => {
    const db = openDb();
    const mine = loginToken(db, "sato", LOGIN_AT);
    const myOther = loginToken(db, "sato", LOGIN_AT);
    const others = loginToken(db, "suzuki", LOGIN_AT);
    const later = ms(LOGIN_AT, 60 * 60 * 1000);
    getSessionUserAndTouch(mine, db, later);
    assert.equal(lastUsedOf(db, mine), later.toISOString());
    assert.equal(lastUsedOf(db, myOther), LOGIN_AT.toISOString());
    assert.equal(lastUsedOf(db, others), LOGIN_AT.toISOString());
  });

  it("期限切れ・不明なトークン・トークンなしでは、どの行も更新せず、未ログインのまま", () => {
    const db = openDb();
    const expired = createSession("sato", db, LOGIN_AT);
    const valid = createSession("sato", db, ms(LOGIN_AT, SESSION_TTL_MS));
    const now = ms(LOGIN_AT, SESSION_TTL_MS + 60 * 60 * 1000);
    for (const token of [expired, "unknown", undefined]) {
      assert.equal(getSessionUserAndTouch(token, db, now), undefined);
      assert.equal(touchSession(token, db, now), false);
    }
    assert.equal(lastUsedOf(db, expired), LOGIN_AT.toISOString());
    assert.equal(lastUsedOf(db, valid), ms(LOGIN_AT, SESSION_TTL_MS).toISOString());
  });

  it("更新しても、有効期限・ログインした日時・前回のログインは変わらない", () => {
    const db = openDb();
    loginToken(db, "sato", ms(LOGIN_AT, -24 * 60 * 60 * 1000));
    const token = loginToken(db, "sato", LOGIN_AT);
    const before = db.prepare("SELECT expires_at, created_at, previous_login_at FROM sessions WHERE token = ?").get(token);
    const windowBefore = getLoginWindow(token, db, LOGIN_AT);
    const later = ms(LOGIN_AT, 60 * 60 * 1000);
    assert.equal(touchSession(token, db, later), true);
    assert.deepEqual(db.prepare("SELECT expires_at, created_at, previous_login_at FROM sessions WHERE token = ?").get(token), before);
    assert.deepEqual(getLoginWindow(token, db, later), windowBefore);
    assert.equal(getPreviousLogin(token, db, later), windowBefore!.previousLoginAt);
  });
});

describe("最後に使った日時の表示", () => {
  it("日本時間で出す（UTC と日付がずれる時刻でも）。分からなければ「不明」", () => {
    assert.equal(formatLastUsedAt("2026-11-11T15:30:00.000Z"), "2026/11/12 00:30");
    assert.equal(formatLastUsedAt(null), "不明");
  });

  it("一覧には本人の端末の日時だけが出て、ほかの利用者の端末は出ない", () => {
    const db = openDb();
    const mine = loginToken(db, "sato", LOGIN_AT);
    const t = ms(LOGIN_AT, 30 * 60 * 1000);
    const others = loginToken(db, "suzuki", t);
    const satoList = listDeviceSessions(mine, db, LOGIN_AT)!;
    assert.equal(satoList.length, 1);
    assert.equal(satoList[0].lastUsedAt, LOGIN_AT.toISOString());
    const suzukiList = listDeviceSessions(others, db, t)!;
    assert.deepEqual(suzukiList.map((s) => s.lastUsedAt), [t.toISOString()]);
    assert.equal(JSON.stringify(suzukiList).includes(mine), false);
  });
});

describe("マイグレーション 21（最後に使った日時）", () => {
  it("記録が始まる前のセッションは「不明」と出て、その端末を使うと記録が始まる", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(
      db,
      MIGRATIONS.filter((m) => m.version < 21),
    );
    db.prepare("INSERT INTO users (id, name) VALUES ('sato', '佐藤')").run();
    const old = createSessionBefore21(db, "sato");
    const other = createSessionBefore21(db, "sato");
    migrate(db, MIGRATIONS);
    const before = listDeviceSessions(other, db, LOGIN_AT)!;
    // 一覧を見た今の端末（other）は記録が始まり、使われていない old は「不明」のまま。
    const oldRow = before.find((s) => !s.current)!;
    assert.equal(oldRow.lastUsedAt, null);
    assert.equal(formatLastUsedAt(oldRow.lastUsedAt), "不明");
    assert.equal(before.find((s) => s.current)!.lastUsedAt, LOGIN_AT.toISOString());
    // old を使うと記録が始まる。
    const later = ms(LOGIN_AT, 60 * 1000);
    assert.equal(touchSession(old, db, later), true);
    assert.equal(lastUsedOf(db, old), later.toISOString());
  });
});

/** マイグレーション 21 より前のスキーマでセッションを作る（last_used_at の列はまだ無い）。 */
function createSessionBefore21(db: Db, userId: string): string {
  const token = crypto.randomUUID().replaceAll("-", "");
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at, created_at, device_id) VALUES (?, ?, ?, ?, lower(hex(randomblob(16))))",
  ).run(token, userId, ms(LOGIN_AT, SESSION_TTL_MS).toISOString(), ms(LOGIN_AT, -60 * 60 * 1000).toISOString());
  return token;
}
