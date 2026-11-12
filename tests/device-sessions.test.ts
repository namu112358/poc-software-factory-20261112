// ログイン中の端末の一覧と、ほかの端末を切る（#334）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_TTL_MS,
  USER_AGENT_MAX_LENGTH,
  createSession,
  getSessionUser,
  login,
  logoutAllDevices,
} from "../src/lib/auth.ts";
import { migrate, openDb, type Db } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import {
  describeDevice,
  formatLoggedInAt,
  isDeviceId,
  listDeviceSessions,
  revokeDeviceSession,
} from "../src/lib/device-sessions.ts";
import { revokeDevice } from "../src/lib/device-revoke.ts";
import { DatabaseSync } from "node:sqlite";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

const T1 = new Date("2026-11-10T09:00:00.000Z");
const T2 = new Date("2026-11-11T15:30:00.000Z"); // 日本時間では 11/12 00:30
const T3 = new Date("2026-11-12T01:00:00.000Z");
const NOW = new Date("2026-11-12T03:00:00.000Z");

function tokenOf(result: ReturnType<typeof login>): string {
  assert.equal(result.ok, true);
  return (result as { token: string }).token;
}

function deviceIdOf(db: Db, token: string): string {
  return (db.prepare("SELECT device_id FROM sessions WHERE token = ?").get(token) as { device_id: string }).device_id;
}

function countSessions(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
}

describe("ログイン中の端末の一覧", () => {
  it("自分のセッションだけが、ログインした日時の新しい順に出る（ほかの利用者のセッションは出ない）", () => {
    const db = openDb();
    const old = tokenOf(login("sato", SEED_PASSWORD, db, T1, FIREFOX_WIN));
    tokenOf(login("suzuki", SEED_PASSWORD, db, T2, CHROME_MAC));
    const current = tokenOf(login("sato", SEED_PASSWORD, db, T2, CHROME_MAC));
    const newest = tokenOf(login("sato", SEED_PASSWORD, db, T3, SAFARI_IPHONE));
    createSession("tanaka", db, T3);

    const list = listDeviceSessions(current, db, NOW);
    assert.deepEqual(
      list?.map((s) => s.id),
      [newest, current, old].map((t) => deviceIdOf(db, t)),
    );
    assert.deepEqual(
      list?.map((s) => [s.loggedInAt, s.device]),
      [
        [T3.toISOString(), "Safari / iOS"],
        [T2.toISOString(), "Chrome / macOS"],
        [T1.toISOString(), "Firefox / Windows"],
      ],
    );
  });

  it("今の端末の行だけが「この端末」（current）になる", () => {
    const db = openDb();
    const a = tokenOf(login("sato", SEED_PASSWORD, db, T1, CHROME_MAC));
    const b = tokenOf(login("sato", SEED_PASSWORD, db, T2, CHROME_MAC));
    assert.deepEqual(
      listDeviceSessions(a, db, NOW)?.map((s) => [s.id, s.current]),
      [
        [deviceIdOf(db, b), false],
        [deviceIdOf(db, a), true],
      ],
    );
  });

  it("期限切れのセッションは出ない", () => {
    const db = openDb();
    const current = createSession("sato", db, NOW);
    createSession("sato", db, new Date(NOW.getTime() - SESSION_TTL_MS)); // ちょうど期限
    createSession("sato", db, new Date(NOW.getTime() - SESSION_TTL_MS - 1));
    assert.deepEqual(
      listDeviceSessions(current, db, NOW)?.map((s) => s.id),
      [deviceIdOf(db, current)],
    );
  });

  it("未ログイン（トークンなし・不明・期限切れ）なら undefined", () => {
    const db = openDb();
    const expired = createSession("sato", db, new Date(NOW.getTime() - SESSION_TTL_MS - 1));
    assert.equal(listDeviceSessions(undefined, db, NOW), undefined);
    assert.equal(listDeviceSessions("unknown", db, NOW), undefined);
    assert.equal(listDeviceSessions(expired, db, NOW), undefined);
  });

  it("一覧にトークンを含めない", () => {
    const db = openDb();
    const token = createSession("sato", db, NOW);
    const json = JSON.stringify(listDeviceSessions(token, db, NOW));
    assert.equal(json.includes(token), false);
  });

  it("ログインした日時が分からないセッションは、日時「不明」・「不明な端末」として最後に出る", () => {
    const db = openDb();
    const current = createSession("sato", db, T1);
    const legacy = createSession("sato", db, T3);
    db.prepare("UPDATE sessions SET created_at = NULL, user_agent = NULL WHERE token = ?").run(legacy);
    const list = listDeviceSessions(current, db, NOW);
    assert.deepEqual(list?.map((s) => s.id), [deviceIdOf(db, current), deviceIdOf(db, legacy)]);
    assert.equal(list?.[1].loggedInAt, null);
    assert.equal(formatLoggedInAt(list![1].loggedInAt), "不明");
    assert.equal(list?.[1].device, "不明な端末");
  });
});

describe("ほかの端末を切る", () => {
  it("切ったセッションのトークンでは以後ログインしていない扱いになり、ほかのセッションは残る", () => {
    const db = openDb();
    const current = tokenOf(login("sato", SEED_PASSWORD, db, T1, CHROME_MAC));
    const target = tokenOf(login("sato", SEED_PASSWORD, db, T2, FIREFOX_WIN));
    const keep = tokenOf(login("sato", SEED_PASSWORD, db, T3, SAFARI_IPHONE));
    const others = createSession("suzuki", db, T3);

    assert.deepEqual(revokeDeviceSession(current, deviceIdOf(db, target), db, NOW), { ok: true });
    assert.equal(getSessionUser(target, db, NOW), undefined);
    assert.equal(listDeviceSessions(target, db, NOW), undefined);
    for (const token of [current, keep]) assert.equal(getSessionUser(token, db, NOW)?.id, "sato");
    assert.equal(getSessionUser(others, db, NOW)?.id, "suzuki");
    assert.equal(countSessions(db), 3);
  });

  it("ほかの利用者のセッションを指定すると not-found で、何も変わらない", () => {
    const db = openDb();
    const current = createSession("sato", db, T1);
    const theirs = createSession("suzuki", db, T1);
    assert.deepEqual(revokeDeviceSession(current, deviceIdOf(db, theirs), db, NOW), {
      ok: false,
      reason: "not-found",
    });
    assert.equal(getSessionUser(theirs, db, NOW)?.id, "suzuki");
    assert.equal(countSessions(db), 2);
  });

  it("存在しない ID・形式の違う ID・トークンそのものは not-found で、何も変わらない", () => {
    const db = openDb();
    const current = createSession("sato", db, T1);
    const other = createSession("sato", db, T1);
    for (const id of ["0".repeat(32), "abc", "", undefined, 1, other, deviceIdOf(db, other).toUpperCase()]) {
      assert.deepEqual(revokeDeviceSession(current, id, db, NOW), { ok: false, reason: "not-found" });
    }
    assert.equal(countSessions(db), 2);
  });

  it("期限切れの自分のセッションを指定すると not-found", () => {
    const db = openDb();
    const current = createSession("sato", db, NOW);
    const expired = createSession("sato", db, new Date(NOW.getTime() - SESSION_TTL_MS - 1));
    assert.deepEqual(revokeDeviceSession(current, deviceIdOf(db, expired), db, NOW), {
      ok: false,
      reason: "not-found",
    });
  });

  it("今の端末を指定すると current で、何も消さない", () => {
    const db = openDb();
    const current = createSession("sato", db, T1);
    createSession("sato", db, T1);
    assert.deepEqual(revokeDeviceSession(current, deviceIdOf(db, current), db, NOW), {
      ok: false,
      reason: "current",
    });
    assert.equal(getSessionUser(current, db, NOW)?.id, "sato");
    assert.equal(countSessions(db), 2);
  });

  it("未ログイン（トークンなし・不明・期限切れ）なら unauthorized で、何も消さない", () => {
    const db = openDb();
    const target = createSession("sato", db, NOW);
    const expired = createSession("sato", db, new Date(NOW.getTime() - SESSION_TTL_MS - 1));
    for (const token of [undefined, "unknown", expired]) {
      assert.deepEqual(revokeDeviceSession(token, deviceIdOf(db, target), db, NOW), {
        ok: false,
        reason: "unauthorized",
      });
    }
    assert.equal(countSessions(db), 2);
  });

  it("すべての端末からのログアウトは、これまでどおりすべてのセッションを消す", () => {
    const db = openDb();
    const a = createSession("sato", db, T1);
    createSession("sato", db, T2);
    logoutAllDevices(a, db, NOW);
    assert.equal(countSessions(db), 0);
  });
});

describe("端末の種類", () => {
  it("User-Agent から「ブラウザ / OS」を出す", () => {
    assert.equal(describeDevice(CHROME_MAC), "Chrome / macOS");
    assert.equal(describeDevice(SAFARI_IPHONE), "Safari / iOS");
    assert.equal(describeDevice(FIREFOX_WIN), "Firefox / Windows");
    assert.equal(describeDevice(EDGE_WIN), "Edge / Windows");
    assert.equal(describeDevice(CHROME_ANDROID), "Chrome / Android");
    assert.equal(
      describeDevice("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36"),
      "Chrome / Linux",
    );
  });

  it("分からなければ「不明な端末」、片方だけ分からなければその側を「不明」と出す", () => {
    assert.equal(describeDevice(null), "不明な端末");
    assert.equal(describeDevice(""), "不明な端末");
    assert.equal(describeDevice("curl/8.5.0"), "不明な端末");
    assert.equal(describeDevice("Mozilla/5.0 (X11; Linux x86_64)"), "不明 / Linux");
    assert.equal(describeDevice("Firefox/133.0"), "Firefox / 不明");
  });

  it("ログインしたときの User-Agent を記録する。無い・空白だけなら不明、長すぎれば上限で切る", () => {
    const db = openDb();
    const ua = (token: string) =>
      (db.prepare("SELECT user_agent FROM sessions WHERE token = ?").get(token) as { user_agent: string | null })
        .user_agent;
    assert.equal(ua(tokenOf(login("sato", SEED_PASSWORD, db, T1, CHROME_MAC))), CHROME_MAC);
    assert.equal(ua(tokenOf(login("sato", SEED_PASSWORD, db, T1))), null);
    assert.equal(ua(tokenOf(login("sato", SEED_PASSWORD, db, T1, "   "))), null);
    const long = CHROME_MAC + "x".repeat(USER_AGENT_MAX_LENGTH);
    assert.equal(ua(tokenOf(login("sato", SEED_PASSWORD, db, T1, long))), long.slice(0, USER_AGENT_MAX_LENGTH));
  });
});

describe("ログインした日時の表示", () => {
  it("日本時間で出す（UTC と日付がずれる時刻でも）", () => {
    assert.equal(formatLoggedInAt(T2.toISOString()), "2026/11/12 00:30");
    assert.equal(formatLoggedInAt(T1.toISOString()), "2026/11/10 18:00");
  });
});

describe("マイグレーション 16（端末の記録）", () => {
  it("既存のセッションは日時・User-Agent が不明のまま残り、端末の ID が別々に振られて一覧に出る", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(
      db,
      MIGRATIONS.filter((m) => m.version < 16),
    );
    db.prepare("INSERT INTO users (id, name) VALUES ('sato', '佐藤')").run();
    const expires = new Date(NOW.getTime() + 1000).toISOString();
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES ('t1', 'sato', ?), ('t2', 'sato', ?)").run(
      expires,
      expires,
    );
    migrate(db);
    const rows = db.prepare("SELECT device_id, created_at, user_agent FROM sessions ORDER BY token").all() as {
      device_id: string;
      created_at: string | null;
      user_agent: string | null;
    }[];
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(isDeviceId(r.device_id), true);
      assert.equal(r.created_at, null);
      assert.equal(r.user_agent, null);
    }
    assert.notEqual(rows[0].device_id, rows[1].device_id);
    const list = listDeviceSessions("t1", db, NOW);
    assert.equal(list?.length, 2);
    assert.deepEqual(revokeDeviceSession("t1", rows[1].device_id, db, NOW), { ok: true });
    assert.equal(getSessionUser("t2", db, NOW), undefined);
  });
});

describe("「この端末を切る」ボタンの送信", () => {
  it("DELETE /api/sessions/:id を送り、成功なら revoked", async () => {
    const calls: [string, string][] = [];
    const result = await revokeDevice("a".repeat(32), {
      fetch: async (url, init) => {
        calls.push([url, init.method]);
        return { ok: true, json: async () => ({ ok: true }) };
      },
    });
    assert.deepEqual(result, { status: "revoked" });
    assert.deepEqual(calls, [[`/api/sessions/${"a".repeat(32)}`, "DELETE"]]);
  });

  it("失敗したら API のエラーの文言、読めなければ・通信に失敗したら既定の文言を返す", async () => {
    assert.deepEqual(
      await revokeDevice("x", { fetch: async () => ({ ok: false, json: async () => ({ error: "端末が見つかりません" }) }) }),
      { status: "error", message: "端末が見つかりません" },
    );
    assert.deepEqual(
      await revokeDevice("x", { fetch: async () => ({ ok: false, json: async () => Promise.reject(new Error()) }) }),
      { status: "error", message: "端末を切れませんでした。" },
    );
    assert.deepEqual(
      await revokeDevice("x", {
        fetch: async () => {
          throw new Error("network");
        },
      }),
      { status: "error", message: "端末を切れませんでした。" },
    );
  });
});
