// ほかの端末で新しくログインがあったとき、ログイン中の自分の端末に知らせる（#478）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  SESSION_TTL_MS,
  changePassword,
  createSession,
  deleteSession,
  formatFailedLoginNotice,
  getFailedLoginsBefore,
  getPreviousLogin,
  login,
  logoutAllDevices,
} from "../src/lib/auth.ts";
import { migrate, openDb, type Db } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { listDeviceSessions, revokeDeviceSession } from "../src/lib/device-sessions.ts";
import { acknowledgeLoginNotice } from "../src/lib/login-notice-ack.ts";
import {
  acknowledgeAllLoginNotices,
  acknowledgeLoginNotices,
  formatLoginNotice,
  getLoginNotice,
  validateAcknowledgeInput,
  type LoginNotice,
} from "../src/lib/login-notices.ts";
import { LOCK_MS, MAX_FAILURES } from "../src/lib/login-throttle.ts";
import { toMeResponse } from "../src/lib/me.ts";

const T0 = new Date("2026-11-13T01:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const PC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const BOT_UA = "python-requests/2.31";

function signIn(db: Db, userId: string, now: Date, ua: string | null = PC_UA): string {
  const result = login(userId, SEED_PASSWORD, db, now, ua);
  assert.equal(result.ok, true);
  return (result as { token: string }).token;
}

function fail(db: Db, userId: string, times: number, now: Date): void {
  for (let i = 0; i < times; i++) assert.equal(login(userId, "wrong-password", db, now).ok, false);
}

function notice(db: Db, token: string, now: Date): LoginNotice {
  const n = getLoginNotice(token, db, now);
  assert.ok(n, "知らせが出るはず");
  return n;
}

describe("ほかの端末で新しくログインがあったときの知らせ", () => {
  it("端末 A でログイン中に端末 B からログインすると、端末 A に B の端末の種類と日時の知らせが出る", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0, PC_UA);
    assert.equal(getLoginNotice(a, db, at(1)), null);
    signIn(db, "sato", at(49), BOT_UA);
    const n = notice(db, a, at(50));
    assert.equal(n.count, 1);
    assert.deepEqual(n.latest, { device: "不明な端末", loggedInAt: at(49).toISOString() });
    assert.equal(formatLoginNotice(n)[0], "新しいログインがありました: 不明な端末、2026/11/13 10:49");
  });

  it("端末 B の種類は User-Agent から出す（ブラウザ / OS）", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0, BOT_UA);
    signIn(db, "sato", at(1), PC_UA);
    assert.equal(notice(db, a, at(2)).latest.device, "Chrome / Windows");
  });

  it("新しくログインした端末 B 自身には、自分のログインの知らせは出ない", () => {
    const db = openDb();
    signIn(db, "sato", T0);
    const b = signIn(db, "sato", at(1), BOT_UA);
    assert.equal(getLoginNotice(b, db, at(2)), null);
  });

  it("端末 A が端末 B より後にログインしたセッションなら、知らせは出ない（自分より前のログインは知らせない）", () => {
    const db = openDb();
    signIn(db, "sato", T0, BOT_UA);
    const a = signIn(db, "sato", at(1), PC_UA);
    assert.equal(getLoginNotice(a, db, at(2)), null);
  });

  it("同じ時刻のログインでも、記録の順で前後を決める（先のセッションにだけ出る）", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    const b = signIn(db, "sato", T0, BOT_UA);
    assert.equal(notice(db, a, T0).count, 1);
    assert.equal(getLoginNotice(b, db, T0), null);
  });

  it("ほかの人（鈴木）の ID のログインは、佐藤の知らせに出ない", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "suzuki", at(1), BOT_UA);
    fail(db, "suzuki", 2, at(2));
    signIn(db, "suzuki", at(3), BOT_UA);
    assert.equal(getLoginNotice(a, db, at(4)), null);
  });

  it("ログインの失敗（パスワードの誤り・ロック中・存在しない ID）は、新しいログインとして知らせない", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    fail(db, "sato", MAX_FAILURES, at(1));
    assert.equal(login("sato", SEED_PASSWORD, db, at(2)).ok, false); // ロック中
    fail(db, "nobody", 2, at(3));
    assert.equal(getLoginNotice(a, db, at(4)), null);
    // ロックが解けたあとに成功すると、そのときに 1 件として出る。
    signIn(db, "sato", new Date(at(1).getTime() + LOCK_MS + 1), BOT_UA);
    assert.equal(notice(db, a, new Date(at(1).getTime() + LOCK_MS + 2)).count, 1);
  });

  it("新しいログインが何回かあれば、いちばん新しいものの端末と日時と、ほかの回数を出す", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), PC_UA);
    signIn(db, "sato", at(2), BOT_UA);
    const n = notice(db, a, at(3));
    assert.equal(n.count, 2);
    assert.equal(n.latest.loggedInAt, at(2).toISOString());
    assert.equal(n.latest.device, "不明な端末");
    assert.deepEqual(formatLoginNotice(n), [
      "新しいログインがありました: 不明な端末、2026/11/13 10:02",
      "このほかにも、新しいログインが 1 回ありました",
    ]);
  });

  it("期限切れ・ログアウトしたセッション・不明なトークンには出さない（未ログイン扱い）", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    assert.equal(getLoginNotice(a, db, new Date(T0.getTime() + SESSION_TTL_MS)), undefined);
    assert.equal(getLoginNotice("unknown", db, at(2)), undefined);
    assert.equal(getLoginNotice(undefined, db, at(2)), undefined);
    deleteSession(a, db);
    assert.equal(getLoginNotice(a, db, at(2)), undefined);
  });
});

describe("新しいログインの前のパスワードの誤り", () => {
  it("端末 B のログインの前の誤りの回数が、端末 A の知らせに出る（端末 B の側で 0 に戻っても）", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    fail(db, "sato", 3, at(48));
    const b = signIn(db, "sato", at(49), BOT_UA);
    const n = notice(db, a, at(50));
    assert.equal(n.failedLogins, 3);
    assert.equal(formatLoginNotice(n)[1], "その前に、パスワードを誤ったログインが 3 回ありました");
    // 端末 B の側は今のまま、誤りの回数を出す。
    assert.equal(getFailedLoginsBefore(b, db, at(50)), 3);
    // その後、佐藤がもう一度ログインし直して回数が 0 で始まっても、端末 A の知らせの回数は残る。
    signIn(db, "sato", at(51));
    assert.equal(notice(db, a, at(52)).failedLogins, 3);
  });

  it("誤りが無ければ回数の行は出さない", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    const n = notice(db, a, at(2));
    assert.equal(n.failedLogins, 0);
    assert.equal(formatLoginNotice(n).length, 1);
  });

  it("新しいログインが何回かあれば、それぞれの前の誤りを合わせて出す", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    fail(db, "sato", 2, at(1));
    signIn(db, "sato", at(2), BOT_UA);
    fail(db, "sato", 1, at(3));
    signIn(db, "sato", at(4), BOT_UA);
    assert.equal(notice(db, a, at(5)).failedLogins, 3);
  });

  it("端末 A のログインより前の誤りは、端末 A の知らせに数えない（A のログインで 0 に戻った分）", () => {
    const db = openDb();
    fail(db, "sato", 2, T0);
    const a = signIn(db, "sato", at(1));
    signIn(db, "sato", at(2), BOT_UA);
    assert.equal(notice(db, a, at(3)).failedLogins, 0);
  });
});

describe("端末 B の側の表示は今のまま", () => {
  it("端末 B には「前回のログイン」（端末 A のログイン）と誤りの回数が出る", () => {
    const db = openDb();
    signIn(db, "sato", T0);
    fail(db, "sato", 3, at(1));
    const b = signIn(db, "sato", at(2), BOT_UA);
    assert.equal(getPreviousLogin(b, db, at(3)), T0.toISOString());
    assert.equal(formatFailedLoginNotice(getFailedLoginsBefore(b, db, at(3))), "前回のログインのあと、パスワードを誤ったログインが 3 回ありました");
  });
});

describe("「確かめた」と、ログイン中の端末の画面を開いたとき", () => {
  it("「確かめた」を押すと、その端末の知らせは消える", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    const n = notice(db, a, at(2));
    assert.equal(acknowledgeLoginNotices(a, n.throughId, db, at(2)), true);
    assert.equal(getLoginNotice(a, db, at(3)), null);
  });

  it("確かめた後に、また新しいログインがあれば、その分だけを知らせる", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    fail(db, "sato", 2, at(1));
    signIn(db, "sato", at(2), BOT_UA);
    acknowledgeLoginNotices(a, notice(db, a, at(3)).throughId, db, at(3));
    signIn(db, "sato", at(4), PC_UA);
    const n = notice(db, a, at(5));
    assert.equal(n.count, 1);
    assert.equal(n.failedLogins, 0);
    assert.equal(n.latest.loggedInAt, at(4).toISOString());
  });

  it("画面に出した後に来たログインは、「確かめた」を押しても消えない", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    const shown = notice(db, a, at(2));
    signIn(db, "sato", at(3), BOT_UA);
    acknowledgeLoginNotices(a, shown.throughId, db, at(4));
    const n = notice(db, a, at(4));
    assert.equal(n.count, 1);
    assert.equal(n.latest.loggedInAt, at(3).toISOString());
  });

  it("まだ無い先の ID を送っても、後から来るログインは先回りで消えない", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    acknowledgeLoginNotices(a, Number.MAX_SAFE_INTEGER, db, at(2));
    assert.equal(getLoginNotice(a, db, at(2)), null);
    signIn(db, "sato", at(3), BOT_UA);
    assert.equal(notice(db, a, at(4)).count, 1);
  });

  it("確かめた位置は後ろに戻らない（古い ID を送っても、消した知らせは出ない）", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    const first = notice(db, a, at(2)).throughId;
    signIn(db, "sato", at(3), BOT_UA);
    acknowledgeLoginNotices(a, notice(db, a, at(4)).throughId, db, at(4));
    acknowledgeLoginNotices(a, first, db, at(5));
    assert.equal(getLoginNotice(a, db, at(5)), null);
  });

  it("ほかの人のログインの記録の ID を送っても、自分の知らせは自分の記録までしか消えない", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    signIn(db, "suzuki", at(2));
    signIn(db, "sato", at(3), BOT_UA);
    const suzukiLatest = (db.prepare("SELECT MAX(id) AS id FROM login_events WHERE user_id = 'suzuki'").get() as { id: number }).id;
    acknowledgeLoginNotices(a, suzukiLatest, db, at(4));
    const n = notice(db, a, at(4));
    assert.equal(n.count, 1);
    assert.equal(n.latest.loggedInAt, at(3).toISOString());
  });

  it("「確かめた」はその端末の分だけで、同じ人のほかの端末の知らせは消さない", () => {
    const db = openDb();
    const a1 = signIn(db, "sato", T0);
    const a2 = signIn(db, "sato", at(1));
    signIn(db, "sato", at(2), BOT_UA);
    acknowledgeLoginNotices(a1, notice(db, a1, at(3)).throughId, db, at(3));
    assert.equal(getLoginNotice(a1, db, at(3)), null);
    assert.equal(notice(db, a2, at(3)).count, 1);
  });

  it("未ログイン（不明なトークン・期限切れ）の「確かめた」は何も変えない", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    const id = notice(db, a, at(2)).throughId;
    assert.equal(acknowledgeLoginNotices("unknown", id, db, at(2)), false);
    assert.equal(acknowledgeLoginNotices(undefined, id, db, at(2)), false);
    assert.equal(acknowledgeLoginNotices(a, id, db, new Date(T0.getTime() + SESSION_TTL_MS)), false);
    assert.equal(notice(db, a, at(2)).count, 1);
  });

  it("ログイン中の端末の画面を開くと（すべて確かめた扱い）、知らせは消え、一覧には端末 B が出る", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    signIn(db, "sato", at(2), BOT_UA);
    const list = listDeviceSessions(a, db, at(3));
    assert.ok(list?.some((s) => s.device === "不明な端末" && !s.current));
    assert.equal(acknowledgeAllLoginNotices(a, db, at(3)), true);
    assert.equal(getLoginNotice(a, db, at(3)), null);
  });
});

describe("ほかの入口から同じセッション・記録を変えたとき", () => {
  it("端末 B がログアウトしても、端末 A の知らせは確かめるまで残る", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    const b = signIn(db, "sato", at(1), BOT_UA);
    deleteSession(b, db);
    assert.equal(notice(db, a, at(2)).count, 1);
  });

  it("端末 A が端末 B を切っても、知らせは確かめるまで残る", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    const other = listDeviceSessions(a, db, at(2))!.find((s) => !s.current)!;
    assert.deepEqual(revokeDeviceSession(a, other.id, db, at(2)), { ok: true });
    assert.equal(notice(db, a, at(3)).count, 1);
  });

  it("端末 A でパスワードを変えて、ほかの端末が切れても、端末 A の知らせは残る", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    assert.deepEqual(
      changePassword("sato", a, { currentPassword: SEED_PASSWORD, newPassword: "new-password-1" }, db, at(2)),
      { ok: true },
    );
    assert.equal(notice(db, a, at(3)).count, 1);
  });

  it("すべての端末からログアウトした後にログインし直した端末には、前のログインの知らせは出ない", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    signIn(db, "sato", at(1), BOT_UA);
    logoutAllDevices(a, db, at(2));
    const again = signIn(db, "sato", at(3));
    assert.equal(getLoginNotice(again, db, at(4)), null);
  });

  it("ログインせずに作ったセッションも、その時点までのログインは知らせない", () => {
    const db = openDb();
    signIn(db, "sato", T0, BOT_UA);
    const s = createSession("sato", db, at(1));
    assert.equal(getLoginNotice(s, db, at(2)), null);
  });
});

describe("マイグレーション（ログインの記録）", () => {
  it("マイグレーションの前からあるセッションには、マイグレーションの後のログインだけを知らせる", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db, MIGRATIONS.filter((m) => m.version < 26));
    db.prepare("INSERT INTO users (id, name, password_hash) VALUES ('sato', '佐藤', 'x')").run();
    db.prepare(
      "INSERT INTO sessions (token, user_id, expires_at, created_at, device_id) VALUES ('old', 'sato', ?, ?, 'd0')",
    ).run(at(60 * 24).toISOString(), T0.toISOString());
    migrate(db);
    assert.equal(getLoginNotice("old", db, at(1)), null);
    db.prepare("INSERT INTO login_events (user_id, logged_in_at, user_agent) VALUES ('sato', ?, ?)").run(
      at(2).toISOString(),
      BOT_UA,
    );
    assert.equal(getLoginNotice("old", db, at(3))?.count, 1);
  });
});

describe("「確かめた」の入力（POST /api/login-notices）", () => {
  it("1 以上の整数の throughId だけを受け付ける", () => {
    assert.deepEqual(validateAcknowledgeInput({ throughId: 3 }), { ok: true, value: { throughId: 3 } });
    for (const body of [undefined, null, [], "3", {}, { throughId: "3" }, { throughId: 0 }, { throughId: -1 }, { throughId: 1.5 }, { throughId: Number.MAX_SAFE_INTEGER + 1 }]) {
      assert.equal(validateAcknowledgeInput(body).ok, false, JSON.stringify(body));
    }
  });

  it("「確かめた」のボタンは、知らせの throughId を JSON で送る", async () => {
    const calls: { url: string; body: string }[] = [];
    const result = await acknowledgeLoginNotice(7, {
      fetch: async (url, init) => {
        calls.push({ url, body: init.body });
        return { ok: true, json: async () => ({ ok: true }) };
      },
    });
    assert.deepEqual(result, { status: "acknowledged" });
    assert.deepEqual(calls, [{ url: "/api/login-notices", body: JSON.stringify({ throughId: 7 }) }]);
  });

  it("失敗したら、応答のエラーの文言（無ければ決まった文言）を返す", async () => {
    const err = await acknowledgeLoginNotice(7, { fetch: async () => ({ ok: false, json: async () => ({ error: "ログインしてください" }) }) });
    assert.deepEqual(err, { status: "error", message: "ログインしてください" });
    const down = await acknowledgeLoginNotice(7, { fetch: async () => { throw new Error("offline"); } });
    assert.deepEqual(down, { status: "error", message: "知らせを消せませんでした。" });
  });
});

describe("GET /api/me の知らせ（API で使う人向け）", () => {
  it("JSON の POST /api/login と同じ login() で端末 B がログインすると、端末 A の /api/me に loginNotice が入る", () => {
    const db = openDb();
    const a = signIn(db, "sato", T0);
    fail(db, "sato", 3, at(48));
    signIn(db, "sato", at(49), BOT_UA);
    const body = toMeResponse({ id: "sato", name: "佐藤" }, getLoginNotice(a, db, at(50)) ?? null);
    assert.deepEqual(body.loginNotice, {
      throughId: body.loginNotice!.throughId,
      count: 1,
      latest: { device: "不明な端末", loggedInAt: at(49).toISOString() },
      failedLogins: 3,
    });
  });

  it("知らせが無ければ loginNotice は null。知らせに別の項目が混ざっていても出さない", () => {
    assert.equal(toMeResponse({ id: "sato", name: "佐藤" }).loginNotice, null);
    const leaky = { throughId: 1, count: 1, latest: { device: "x", loggedInAt: T0.toISOString(), user_agent: "secret" }, failedLogins: 0, token: "secret" };
    const text = JSON.stringify(toMeResponse({ id: "sato", name: "佐藤" }, leaky as unknown as LoginNotice));
    assert.ok(!text.includes("secret"));
  });
});
