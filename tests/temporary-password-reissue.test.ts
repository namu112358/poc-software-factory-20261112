// 取りまとめる人が、メンバーに仮のパスワードを出し直せる（#566）。
// API Route（src/app/api/users/[id]/temporary-password/route.ts）は next/server を読み込むため単体テストから呼べない。
// ルートは、ログインの確認（requireApiUser）の後に reissueTemporaryPassword の結果をそのまま応答の番号（403・400・404・409・201）にする。
// ここでは、その判定と、出し直しの効き目（前のパスワード・セッション・止め・記録・知らせ・一覧）を確かめる。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { changePassword, createSession, getSessionUser, login } from "../src/lib/auth.ts";
import { parseOptionalJson } from "../src/lib/body-fields.ts";
import {
  REISSUE_REFUSAL_MESSAGES,
  TEMPORARY_PASSWORD_LENGTH,
  changeUserRole,
  createMember,
  latestPendingReissue,
  listUserOptions,
  listUserSummaries,
  mustChangePassword,
  reissueTemporaryPassword,
  resumeUser,
  suspendUser,
} from "../src/lib/users.ts";
import { listMemberWorkload } from "../src/lib/members.ts";
import {
  TEMPORARY_PASSWORD_PENDING_LABEL,
  reissueConfirmMessage,
  reissueNoticeFor,
  requestTemporaryPassword,
  showReissueControl,
} from "../src/lib/member-temporary-password.ts";

type Db = ReturnType<typeof openDb>;
const NOW = new Date("2026-11-13T06:17:00.000Z"); // 日本時間 11月13日 15時17分
const LATER = new Date("2026-11-13T07:00:00.000Z");

function reissue(db: Db, target = "sato", actor = "tanaka", body: unknown = undefined, now = NOW) {
  const r = reissueTemporaryPassword(actor, target, body, db, now);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as Extract<typeof r, { ok: true }>;
}

function passwordHash(db: Db, id: string): string {
  return (db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string }).password_hash;
}

function sessionCount(db: Db, id: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(id) as { n: number }).n;
}

function reissueCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM temporary_password_reissues").get() as { n: number }).n;
}

describe("reissueTemporaryPassword: 取りまとめる人が仮のパスワードを出し直す", () => {
  it("新しい仮のパスワード（20 文字）を返し、平文は保存しない", () => {
    const db = openDb();
    const r = reissue(db);
    assert.deepEqual(r.user, { id: "sato", name: "佐藤" });
    assert.equal(r.temporaryPassword.length, TEMPORARY_PASSWORD_LENGTH);
    assert.notEqual(passwordHash(db, "sato"), r.temporaryPassword);
    assert.equal(passwordHash(db, "sato").includes(r.temporaryPassword), false);
  });

  it("出し直すたびに違う仮のパスワードになる", () => {
    const db = openDb();
    assert.notEqual(reissue(db).temporaryPassword, reissue(db).temporaryPassword);
  });

  it("本文が無い・空の {} なら受け付ける", () => {
    const db = openDb();
    reissue(db, "sato", "tanaka", undefined);
    reissue(db, "sato", "tanaka", {});
  });
});

describe("出し直しの効き目: 前のパスワード・ログイン中の端末・止め", () => {
  it("前のパスワードではログインできず、新しい仮のパスワードでログインできる", () => {
    const db = openDb();
    const r = reissue(db);
    assert.equal(login("sato", SEED_PASSWORD, db, NOW).ok, false);
    assert.equal(login("sato", r.temporaryPassword, db, NOW).ok, true);
  });

  it("ログイン中の端末（期限切れを含む）はすべてログインが切れ、操作した人のセッションは残る", () => {
    const db = openDb();
    const a = createSession("sato", db, NOW);
    const b = createSession("sato", db, NOW);
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run("2000-01-01T00:00:00.000Z", b);
    const mine = createSession("tanaka", db, NOW);
    reissue(db);
    assert.equal(getSessionUser(a, db, NOW), undefined);
    assert.equal(sessionCount(db, "sato"), 0);
    assert.equal(getSessionUser(mine, db, NOW)?.id, "tanaka");
  });

  it("出し直した人は、自分のパスワードに変えるまで仮のパスワードのまま（ほかの画面と API を使えない）", () => {
    const db = openDb();
    const r = reissue(db);
    assert.equal(mustChangePassword("sato", db), true);
    const logged = login("sato", r.temporaryPassword, db, NOW);
    assert.equal(logged.ok, true);
    if (!logged.ok) return;
    const changed = changePassword("sato", logged.token, { currentPassword: r.temporaryPassword, newPassword: "my-own-pass-1" }, db, NOW);
    assert.equal(changed.ok, true);
    assert.equal(mustChangePassword("sato", db), false);
    assert.equal(login("sato", r.temporaryPassword, db, NOW).ok, false);
    assert.equal(login("sato", "my-own-pass-1", db, NOW).ok, true);
  });

  it("2 回続けて出し直すと、1 回目の仮のパスワードは使えない", () => {
    const db = openDb();
    const first = reissue(db);
    const second = reissue(db);
    assert.equal(login("sato", first.temporaryPassword, db, NOW).ok, false);
    assert.equal(login("sato", second.temporaryPassword, db, NOW).ok, true);
  });

  it("取りまとめる人が、ほかの取りまとめる人に出し直せる", () => {
    const db = openDb();
    assert.equal(changeUserRole("tanaka", "suzuki", { role: "coordinator" }, db).ok, true);
    const r = reissue(db, "tanaka", "suzuki");
    assert.equal(login("tanaka", r.temporaryPassword, db, NOW).ok, true);
    assert.equal(mustChangePassword("tanaka", db), true);
  });

  it("出し直した人は、変えるまでも担当者の選択肢に残る（作ったばかりの人と同じ）", () => {
    const db = openDb();
    reissue(db);
    assert.equal(listUserOptions(db).some((u) => u.id === "sato"), true);
  });
});

describe("出し直しを断る: 権限・自分・いない人・停止中・本文", () => {
  function assertUnchanged(db: Db, before: { hash: string; sessions: number }, id = "sato") {
    assert.equal(passwordHash(db, id), before.hash);
    assert.equal(sessionCount(db, id), before.sessions);
    assert.equal(mustChangePassword(id, db), false);
    assert.equal(reissueCount(db), 0);
  }

  function snapshot(db: Db, id = "sato") {
    createSession(id, db, NOW);
    return { hash: passwordHash(db, id), sessions: sessionCount(db, id) };
  }

  it("取りまとめる人でない人は forbidden（本文に誤りがあっても forbidden）で、何も変えない", () => {
    const db = openDb();
    const before = snapshot(db);
    assert.deepEqual(reissueTemporaryPassword("suzuki", "sato", undefined, db, NOW), { ok: false, reason: "forbidden" });
    assert.deepEqual(reissueTemporaryPassword("suzuki", "sato", { x: 1 }, db, NOW), { ok: false, reason: "forbidden" });
    assertUnchanged(db, before);
  });

  it("停止中の取りまとめる人は forbidden", () => {
    const db = openDb();
    assert.equal(changeUserRole("tanaka", "suzuki", { role: "coordinator" }, db).ok, true);
    assert.equal(suspendUser("suzuki", "tanaka", db, NOW).ok, true);
    // 停止の判定は suspended_at だけで行う。役割はそのまま残る
    const before = snapshot(db);
    assert.deepEqual(reissueTemporaryPassword("tanaka", "sato", undefined, db, NOW), { ok: false, reason: "forbidden" });
    assertUnchanged(db, before);
  });

  it("自分自身には出し直せない（self）", () => {
    const db = openDb();
    const before = snapshot(db, "tanaka");
    assert.deepEqual(reissueTemporaryPassword("tanaka", "tanaka", undefined, db, NOW), { ok: false, reason: "self" });
    assertUnchanged(db, before, "tanaka");
  });

  it("いない人は not_found", () => {
    const db = openDb();
    assert.deepEqual(reissueTemporaryPassword("tanaka", "nobody", undefined, db, NOW), { ok: false, reason: "not_found" });
    assert.equal(reissueCount(db), 0);
  });

  it("停止中の人は suspended。再開した後なら出し直せる", () => {
    const db = openDb();
    assert.equal(suspendUser("tanaka", "sato", db, NOW).ok, true);
    const hash = passwordHash(db, "sato");
    assert.deepEqual(reissueTemporaryPassword("tanaka", "sato", undefined, db, NOW), { ok: false, reason: "suspended" });
    assert.equal(passwordHash(db, "sato"), hash);
    assert.equal(mustChangePassword("sato", db), false);
    assert.equal(reissueCount(db), 0);
    assert.equal(resumeUser("tanaka", "sato", db).ok, true);
    reissue(db);
  });

  it("本文に項目があれば invalid（項目ごとの理由つき）で、何も変えない", () => {
    const db = openDb();
    const before = snapshot(db);
    const r = reissueTemporaryPassword("tanaka", "sato", { password: "x", reason: "y" }, db, NOW);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "invalid");
    assert.equal(!r.ok && r.reason === "invalid" && r.errors.length, 2);
    assert.match(!r.ok && r.reason === "invalid" ? r.errors[0] : "", /password は受け付けない項目です/);
    assertUnchanged(db, before);
  });

  it("オブジェクトでない本文（配列・文字列・null・読めない JSON）は invalid", () => {
    const db = openDb();
    for (const text of ["[]", "\"x\"", "null", "1", "{oops"]) {
      const r = reissueTemporaryPassword("tanaka", "sato", parseOptionalJson(text), db, NOW);
      assert.equal(!r.ok && r.reason, "invalid", text);
    }
    assert.equal(reissueCount(db), 0);
  });

  it("本文の判定は、相手がいるか・自分かより先に行う（入力誤りは 400）", () => {
    const db = openDb();
    assert.equal((reissueTemporaryPassword("tanaka", "nobody", { x: 1 }, db, NOW) as { reason: string }).reason, "invalid");
  });

  it("断る理由ごとに日本語の文言がある", () => {
    for (const reason of ["forbidden", "invalid", "not_found", "self", "suspended"] as const) {
      assert.ok(REISSUE_REFUSAL_MESSAGES[reason].length > 0);
    }
  });
});

describe("parseOptionalJson: 本文を受け付けない API の本文の読み取り", () => {
  it("空・空白だけは undefined、JSON は値、読めない JSON は文字列のまま", () => {
    assert.equal(parseOptionalJson(""), undefined);
    assert.equal(parseOptionalJson("  \n"), undefined);
    assert.deepEqual(parseOptionalJson("{}"), {});
    assert.equal(parseOptionalJson("{oops"), "{oops");
  });
});

describe("仮のパスワードのままかが一覧で分かる", () => {
  it("出し直すと、メンバーの画面と GET /api/users の両方で仮のパスワードのままになり、本人が変えると外れる", () => {
    const db = openDb();
    const flag = () => ({
      workload: listMemberWorkload(db).find((m) => m.id === "sato")?.mustChangePassword,
      api: listUserSummaries(db).find((u) => u.id === "sato")?.mustChangePassword,
    });
    assert.deepEqual(flag(), { workload: false, api: false });
    const r = reissue(db);
    assert.deepEqual(flag(), { workload: true, api: true });
    const logged = login("sato", r.temporaryPassword, db, NOW);
    assert.equal(logged.ok, true);
    if (!logged.ok) return;
    changePassword("sato", logged.token, { currentPassword: r.temporaryPassword, newPassword: "my-own-pass-1" }, db, NOW);
    assert.deepEqual(flag(), { workload: false, api: false });
  });

  it("作ったばかりの人（#523）も、仮のパスワードのままと分かる", () => {
    const db = openDb();
    assert.equal(createMember("tanaka", { userId: "yamada", name: "山田" }, db).ok, true);
    assert.equal(listMemberWorkload(db).find((m) => m.id === "yamada")?.mustChangePassword, true);
    assert.equal(listUserSummaries(db).find((u) => u.id === "yamada")?.mustChangePassword, true);
  });

  it("一覧に添える文言は「仮のパスワードのまま」", () => {
    assert.equal(TEMPORARY_PASSWORD_PENDING_LABEL, "仮のパスワードのまま");
  });
});

describe("出し直しの記録と、本人への知らせ", () => {
  it("だれが・いつ出し直したかを記録し、本人が仮のパスワードのままの間、知らせる", () => {
    const db = openDb();
    reissue(db);
    const row = db.prepare("SELECT user_id, issued_by, issued_at FROM temporary_password_reissues").get() as Record<string, string>;
    assert.deepEqual({ ...row }, { user_id: "sato", issued_by: "tanaka", issued_at: NOW.toISOString() });
    const latest = latestPendingReissue("sato", db);
    assert.deepEqual(latest, { issuedBy: { id: "tanaka", name: "田中" }, issuedAt: NOW.toISOString() });
    assert.equal(reissueNoticeFor(latest!.issuedBy.name, latest!.issuedAt), "取りまとめる人 田中 さんが 11月13日 15時17分 に仮のパスワードを出し直しました");
  });

  it("作ったばかりで出し直していない人（#523）には知らせない", () => {
    const db = openDb();
    assert.equal(createMember("tanaka", { userId: "yamada", name: "山田" }, db).ok, true);
    assert.equal(mustChangePassword("yamada", db), true);
    assert.equal(latestPendingReissue("yamada", db), undefined);
  });

  it("作った後に出し直した人には知らせる", () => {
    const db = openDb();
    assert.equal(createMember("tanaka", { userId: "yamada", name: "山田" }, db).ok, true);
    reissue(db, "yamada");
    assert.equal(latestPendingReissue("yamada", db)?.issuedBy.id, "tanaka");
  });

  it("本人が自分のパスワードに変えたら知らせない。もう一度出し直したら、いちばん新しい出し直しを知らせる", () => {
    const db = openDb();
    const r = reissue(db);
    const logged = login("sato", r.temporaryPassword, db, NOW);
    assert.equal(logged.ok, true);
    if (!logged.ok) return;
    changePassword("sato", logged.token, { currentPassword: r.temporaryPassword, newPassword: "my-own-pass-1" }, db, NOW);
    assert.equal(latestPendingReissue("sato", db), undefined);
    assert.equal(changeUserRole("tanaka", "suzuki", { role: "coordinator" }, db).ok, true);
    reissue(db, "sato", "suzuki", undefined, LATER);
    assert.deepEqual(latestPendingReissue("sato", db), { issuedBy: { id: "suzuki", name: "鈴木" }, issuedAt: LATER.toISOString() });
    assert.equal(reissueCount(db), 2);
  });

  it("知らせの日時は日本時間（UTC の夜は翌日の日付になる）", () => {
    assert.equal(reissueNoticeFor("田中", "2026-11-13T15:05:00.000Z"), "取りまとめる人 田中 さんが 11月14日 0時5分 に仮のパスワードを出し直しました");
  });
});

describe("メンバーの画面の出し直しの操作", () => {
  const coordinator = { id: "tanaka", isCoordinator: true };

  it("取りまとめる人には、ほかの利用中のメンバーの行に出す", () => {
    assert.equal(showReissueControl(coordinator, { id: "sato", suspended: false }), true);
  });

  it("取りまとめる人でない人・自分の行・停止中の人の行には出さない", () => {
    assert.equal(showReissueControl({ id: "sato", isCoordinator: false }, { id: "suzuki", suspended: false }), false);
    assert.equal(showReissueControl(coordinator, { id: "tanaka", suspended: false }), false);
    assert.equal(showReissueControl(coordinator, { id: "sato", suspended: true }), false);
  });

  it("確認の文言は、前のパスワードが使えなくなり、端末がログアウトすることを伝える", () => {
    const m = reissueConfirmMessage("佐藤");
    assert.match(m, /佐藤 さん/);
    assert.match(m, /使えなくなり/);
    assert.match(m, /ログアウト/);
  });

  it("出し直しの API を本文なしの POST で呼び、成功なら新しい仮のパスワードを返す", async () => {
    const calls: { url: string; method: string }[] = [];
    const result = await requestTemporaryPassword("sato", {
      fetch: async (url, init) => {
        calls.push({ url, method: init.method });
        return { ok: true, json: async () => ({ user: { id: "sato", name: "佐藤" }, temporaryPassword: "abc" }) };
      },
    });
    assert.deepEqual(calls, [{ url: "/api/users/sato/temporary-password", method: "POST" }]);
    assert.deepEqual(result, { status: "done", temporaryPassword: "abc" });
  });

  it("断られたら API の理由を、通信に失敗したら決まった文言を返す", async () => {
    const refused = await requestTemporaryPassword("sato", {
      fetch: async () => ({ ok: false, json: async () => ({ error: REISSUE_REFUSAL_MESSAGES.suspended }) }),
    });
    assert.deepEqual(refused, { status: "error", message: REISSUE_REFUSAL_MESSAGES.suspended });
    const failed = await requestTemporaryPassword("sato", {
      fetch: async () => {
        throw new Error("network");
      },
    });
    assert.deepEqual(failed, { status: "error", message: "仮のパスワードを出し直せませんでした。" });
  });
});
