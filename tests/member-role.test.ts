// 取りまとめる人の役割を、画面と API で付け替えられる（#524）。
// API Route（src/app/api/users/[id]/role/route.ts）は next/server を読み込むため単体テストから呼べない。
// ルートは、ログインの確認の後に changeUserRole の結果をそのまま応答の番号（403・400・404・409・200）にする。
// 画面のボタンは member-role.ts の setMemberRole で、同じ API を呼ぶ。ここでは、その判定と、替えたときの効き目を確かめる。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import {
  changeUserRole,
  createMember,
  getUserRole,
  isCoordinator,
  listUserOptions,
  listUserSummaries,
  resumeUser,
  ROLE_CHANGE_REFUSAL_MESSAGES,
  suspendUser,
  validateRoleInput,
} from "../src/lib/users.ts";
import { createExtension, decideExtension, getExtension } from "../src/lib/extensions.ts";
import { listExtensionsAwaitingMe } from "../src/lib/my-attention.ts";
import { listMemberWorkload } from "../src/lib/members.ts";
import { toMeResponse } from "../src/lib/me.ts";
import { roleButtonLabel, roleConfirmMessage, roleControlFor, roleLabel, setMemberRole } from "../src/lib/member-role.ts";

type Db = ReturnType<typeof openDb>;
const NOW = new Date("2026-11-13T04:00:00.000Z");

const roles = (db: Db) => Object.fromEntries(listUserSummaries(db).map((u) => [u.id, u.role]));

function change(db: Db, actor: string, target: string, role: string) {
  return changeUserRole(actor, target, { role }, db);
}

function promote(db: Db, target: string, actor = "tanaka") {
  const r = change(db, actor, target, "coordinator");
  assert.equal(r.ok, true, JSON.stringify(r));
}

function pendingExtension(db: Db, requester = "sato") {
  const ext = createExtension({ taskId: 3, requester, newDueDate: "2026-11-30", reason: "レビュー待ち" }, db, NOW);
  if (ext === "conflict") throw new Error("setup");
  return ext;
}

describe("取りまとめる人が、ほかのメンバーの役割を替えられる", () => {
  it("田中が鈴木を取りまとめる人にし、メンバーに戻せる（応答は id・name・role）", () => {
    const db = openDb();
    assert.deepEqual(change(db, "tanaka", "suzuki", "coordinator"), {
      ok: true,
      user: { id: "suzuki", name: "鈴木", role: "coordinator" },
    });
    assert.equal(isCoordinator("suzuki", db), true);
    assert.deepEqual(change(db, "tanaka", "suzuki", "member"), { ok: true, user: { id: "suzuki", name: "鈴木", role: "member" } });
    assert.equal(isCoordinator("suzuki", db), false);
  });

  it("新しく加えたメンバー（#523）も取りまとめる人にできる", () => {
    const db = openDb();
    assert.equal(createMember("tanaka", { userId: "yamada", name: "山田" }, db).ok, true);
    promote(db, "yamada");
    assert.equal(getUserRole("yamada", db), "coordinator");
  });

  it("取りまとめる人にした人は、ほかの取りまとめる人をメンバーに戻せる（交代できる）", () => {
    const db = openDb();
    promote(db, "sato");
    assert.equal(change(db, "sato", "tanaka", "member").ok, true);
    assert.deepEqual(roles(db), { sato: "coordinator", suzuki: "member", tanaka: "member" });
  });

  it("今と同じ役割を送ると、何も変えずに成功を返す（くり返しても同じ）", () => {
    const db = openDb();
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(change(db, "tanaka", "tanaka", "coordinator"), {
        ok: true,
        user: { id: "tanaka", name: "田中", role: "coordinator" },
      });
      assert.deepEqual(change(db, "tanaka", "sato", "member"), { ok: true, user: { id: "sato", name: "佐藤", role: "member" } });
    }
    assert.deepEqual(roles(db), { sato: "member", suzuki: "member", tanaka: "coordinator" });
  });

  it("相手がいなければ not_found（404）", () => {
    const db = openDb();
    assert.deepEqual(change(db, "tanaka", "nobody", "coordinator"), { ok: false, reason: "not_found" });
  });
});

describe("取りまとめる人でない人は替えられない（403）", () => {
  it("メンバー・いない人・停止中の取りまとめる人は forbidden で、何も変わらない", () => {
    const db = openDb();
    promote(db, "suzuki");
    assert.equal(suspendUser("tanaka", "suzuki", db, NOW).ok, true);
    for (const actor of ["sato", "nobody", "suzuki"]) {
      assert.deepEqual(change(db, actor, "sato", "coordinator"), { ok: false, reason: "forbidden" }, actor);
      assert.deepEqual(change(db, actor, actor, "coordinator"), { ok: false, reason: "forbidden" }, actor);
    }
    assert.deepEqual(roles(db), { sato: "member", suzuki: "coordinator", tanaka: "coordinator" });
  });

  it("forbidden の判定は、入力の誤りや相手がいないことより先", () => {
    const db = openDb();
    assert.deepEqual(changeUserRole("sato", "nobody", { role: "admin" }, db), { ok: false, reason: "forbidden" });
    assert.deepEqual(changeUserRole("sato", "suzuki", undefined, db), { ok: false, reason: "forbidden" });
  });

  it("理由の文言がある", () => {
    assert.match(ROLE_CHANGE_REFUSAL_MESSAGES.forbidden, /取りまとめる人だけ/);
  });
});

describe("入力の誤りは 400", () => {
  for (const [label, body] of [
    ["role が無い", {}],
    ["ほかの値", { role: "admin" }],
    ["大文字", { role: "Coordinator" }],
    ["空", { role: "" }],
    ["数値", { role: 1 }],
    ["配列", { role: ["coordinator"] }],
    ["本文が配列", ["coordinator"]],
    ["本文が無い（JSON でない）", undefined],
    ["本文が文字列", "coordinator"],
  ] as const) {
    it(`${label}なら invalid で、何も変わらない`, () => {
      const db = openDb();
      const r = changeUserRole("tanaka", "suzuki", body, db);
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.reason, "invalid");
      assert.ok(!r.ok && r.reason === "invalid" && r.errors.length > 0);
      assert.equal(getUserRole("suzuki", db), "member");
    });
  }

  it("知らない項目が混ざっていれば、役割が正しくても invalid", () => {
    const db = openDb();
    const r = changeUserRole("tanaka", "suzuki", { role: "coordinator", suspended: false }, db);
    assert.equal(!r.ok && r.reason, "invalid");
    assert.equal(getUserRole("suzuki", db), "member");
  });

  it("validateRoleInput は coordinator と member だけを受け付ける", () => {
    assert.deepEqual(validateRoleInput({ role: "coordinator" }), { ok: true, value: { role: "coordinator" } });
    assert.deepEqual(validateRoleInput({ role: "member" }), { ok: true, value: { role: "member" } });
  });
});

describe("取りまとめる人が 1 人もいなくなる変更はできない（409）", () => {
  it("取りまとめる人が自分だけのとき、自分をメンバーに戻せない（理由つき）", () => {
    const db = openDb();
    assert.deepEqual(change(db, "tanaka", "tanaka", "member"), { ok: false, reason: "last_coordinator" });
    assert.equal(getUserRole("tanaka", db), "coordinator");
    assert.match(ROLE_CHANGE_REFUSAL_MESSAGES.last_coordinator, /1 人もいなくなる/);
  });

  it("ほかに取りまとめる人がいれば、自分をメンバーに戻せる。戻した後は、残った人を戻せない", () => {
    const db = openDb();
    promote(db, "suzuki");
    assert.equal(change(db, "tanaka", "tanaka", "member").ok, true);
    assert.equal(isCoordinator("tanaka", db), false);
    assert.deepEqual(change(db, "suzuki", "suzuki", "member"), { ok: false, reason: "last_coordinator" });
    assert.equal(getUserRole("suzuki", db), "coordinator");
  });

  it("停止中の取りまとめる人は数えない（残るのが停止中の人だけになる変更は断る）", () => {
    const db = openDb();
    promote(db, "suzuki");
    assert.equal(suspendUser("tanaka", "suzuki", db, NOW).ok, true);
    assert.deepEqual(change(db, "tanaka", "tanaka", "member"), { ok: false, reason: "last_coordinator" });
    assert.equal(getUserRole("tanaka", db), "coordinator");
  });

  it("2 人の取りまとめる人が続けて自分を戻しても、最後の 1 人は残る（数え直してから書く）", () => {
    const db = openDb();
    promote(db, "suzuki");
    const results = [change(db, "tanaka", "tanaka", "member"), change(db, "suzuki", "suzuki", "member")];
    assert.deepEqual(results.map((r) => r.ok), [true, false]);
    assert.equal(listUserSummaries(db).filter((u) => u.role === "coordinator").length, 1);
  });

  it("停止中の取りまとめる人をメンバーに戻すのはできる（権限を減らすだけ）", () => {
    const db = openDb();
    promote(db, "suzuki");
    assert.equal(suspendUser("tanaka", "suzuki", db, NOW).ok, true);
    assert.equal(change(db, "tanaka", "suzuki", "member").ok, true);
    assert.equal(getUserRole("suzuki", db), "member");
  });
});

describe("停止中のメンバーは、取りまとめる人にできない（#522）", () => {
  it("停止中なら suspended（409）で、理由つき。再開すれば取りまとめる人にできる", () => {
    const db = openDb();
    assert.equal(suspendUser("tanaka", "sato", db, NOW).ok, true);
    assert.deepEqual(change(db, "tanaka", "sato", "coordinator"), { ok: false, reason: "suspended" });
    assert.equal(getUserRole("sato", db), "member");
    assert.match(ROLE_CHANGE_REFUSAL_MESSAGES.suspended, /停止/);
    assert.equal(resumeUser("tanaka", "sato", db).ok, true);
    promote(db, "sato");
  });

  it("停止中の取りまとめる人を再開すると、取りまとめる人として戻る", () => {
    const db = openDb();
    promote(db, "suzuki");
    assert.equal(suspendUser("tanaka", "suzuki", db, NOW).ok, true);
    assert.equal(resumeUser("tanaka", "suzuki", db).ok, true);
    assert.equal(isCoordinator("suzuki", db), true);
    assert.equal(change(db, "suzuki", "sato", "coordinator").ok, true);
  });
});

describe("役割を替えると、次の要求から、できる人が変わる", () => {
  it("取りまとめる人にした人は延長を承認でき、メンバーに戻すとできなくなる。戻した後にまた替えれば、またできる", () => {
    const db = openDb();
    const ext = pendingExtension(db);
    assert.deepEqual(decideExtension(3, ext.id, "approved", "suzuki", db, NOW), { result: "forbidden", reason: "not_coordinator" });
    promote(db, "suzuki");
    assert.equal(listExtensionsAwaitingMe("suzuki", db).length, 1);
    assert.equal(change(db, "tanaka", "suzuki", "member").ok, true);
    assert.deepEqual(decideExtension(3, ext.id, "approved", "suzuki", db, NOW), { result: "forbidden", reason: "not_coordinator" });
    assert.equal(listExtensionsAwaitingMe("suzuki", db).length, 0);
    promote(db, "suzuki");
    assert.equal(decideExtension(3, ext.id, "rejected", "suzuki", db, NOW).result, "decided");
    assert.equal(getExtension(ext.id, db)!.decidedBy, "suzuki");
  });

  it("メンバーに戻された人は、メンバーの追加・停止・役割の変更ができなくなる", () => {
    const db = openDb();
    promote(db, "suzuki");
    assert.equal(change(db, "suzuki", "tanaka", "member").ok, true);
    assert.equal(createMember("tanaka", { userId: "yamada", name: "山田" }, db).ok, false);
    assert.deepEqual(suspendUser("tanaka", "sato", db, NOW), { ok: false, reason: "forbidden" });
    assert.deepEqual(change(db, "tanaka", "sato", "coordinator"), { ok: false, reason: "forbidden" });
  });
});

describe("役割が、メンバーの一覧・GET /api/users・GET /api/me に出る", () => {
  it("GET /api/users の各行に role が入り、今ある項目（id・name・suspended）はそのまま", () => {
    const db = openDb();
    promote(db, "sato");
    assert.deepEqual(listUserSummaries(db), [
      { id: "sato", name: "佐藤", suspended: false, role: "coordinator" },
      { id: "suzuki", name: "鈴木", suspended: false, role: "member" },
      { id: "tanaka", name: "田中", suspended: false, role: "coordinator" },
    ]);
  });

  it("GET /api/me の user に role が入り、id・name はそのまま", () => {
    const db = openDb();
    const me = toMeResponse({ id: "tanaka", name: "田中", role: getUserRole("tanaka", db)! });
    assert.deepEqual(me.user, { id: "tanaka", name: "田中", role: "coordinator" });
    assert.equal(toMeResponse({ id: "sato", name: "佐藤", role: getUserRole("sato", db)! }).user.role, "member");
  });

  it("メンバーの一覧の行に役割が入り、替えるとすぐに変わる", () => {
    const db = openDb();
    const before = listMemberWorkload(db, "2026-11-13").find((m) => m.id === "suzuki")!;
    assert.equal(roleLabel(before.role), "メンバー");
    promote(db, "suzuki");
    const after = listMemberWorkload(db, "2026-11-13").find((m) => m.id === "suzuki")!;
    assert.equal(roleLabel(after.role), "取りまとめる人");
  });

  it("担当者の候補（GET /api/assignees）と停止・再開の応答の形は変えない", () => {
    const db = openDb();
    for (const u of listUserOptions(db)) assert.deepEqual(Object.keys(u).sort(), ["id", "name"]);
    const r = suspendUser("tanaka", "sato", db, NOW);
    assert.deepEqual(r, { ok: true, user: { id: "sato", name: "佐藤", suspended: true } });
  });
});

describe("メンバーの一覧の役割の操作（画面）", () => {
  const coordinator = { isCoordinator: true };
  const member = { isCoordinator: false };

  it("取りまとめる人でない人には、どの行にも操作を出さない", () => {
    for (const row of [
      { role: "member" as const, suspended: false },
      { role: "coordinator" as const, suspended: false },
    ]) {
      assert.equal(roleControlFor(member, row), null);
    }
  });

  it("取りまとめる人には、メンバーの行に「取りまとめる人にする」、取りまとめる人の行（自分を含む）に「メンバーに戻す」を出す", () => {
    assert.equal(roleControlFor(coordinator, { role: "member", suspended: false }), "coordinator");
    assert.equal(roleControlFor(coordinator, { role: "coordinator", suspended: false }), "member");
    assert.equal(roleButtonLabel("coordinator"), "取りまとめる人にする");
    assert.equal(roleButtonLabel("member"), "メンバーに戻す");
  });

  it("停止中のメンバーには「取りまとめる人にする」を出さない。停止中の取りまとめる人には「メンバーに戻す」を出す", () => {
    assert.equal(roleControlFor(coordinator, { role: "member", suspended: true }), null);
    assert.equal(roleControlFor(coordinator, { role: "coordinator", suspended: true }), "member");
  });

  it("確かめの文言は、自分を戻すときに権限を失うことを伝える", () => {
    assert.match(roleConfirmMessage("田中", "member", true), /自分をメンバーに戻しますか/);
    assert.match(roleConfirmMessage("鈴木", "member", false), /鈴木 さんをメンバーに戻しますか/);
    assert.match(roleConfirmMessage("鈴木", "coordinator", false), /鈴木 さんを取りまとめる人にしますか/);
  });

  it("ボタンは PUT /api/users/:id/role に { role } を送り、断られたら API の理由を返す", async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const ok = await setMemberRole("suzuki", "coordinator", {
      fetch: async (url, init) => {
        calls.push({ url, method: init.method, body: init.body });
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.deepEqual(ok, { status: "done", role: "coordinator" });
    assert.deepEqual(calls, [{ url: "/api/users/suzuki/role", method: "PUT", body: JSON.stringify({ role: "coordinator" }) }]);

    const refused = await setMemberRole("tanaka", "member", {
      fetch: async () => ({ ok: false, json: async () => ({ error: ROLE_CHANGE_REFUSAL_MESSAGES.last_coordinator }) }),
    });
    assert.deepEqual(refused, { status: "error", message: ROLE_CHANGE_REFUSAL_MESSAGES.last_coordinator });

    const broken = await setMemberRole("tanaka", "member", {
      fetch: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(broken.status, "error");
  });
});
