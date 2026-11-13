// 取りまとめる人が、新しいメンバーのアカウントを作れる（仮のパスワードつき。#523）。
// API Route（src/app/api/users/route.ts など）は next/server を読み込むため単体テストから呼べない。
// ルートは、ログインの確認（requireApiUser）の後に createMember の結果をそのまま応答の番号（403・400・409・201）にする。
// 仮のパスワードの間の止め（画面は requireUser、API は requireApiUser と端末の API）は、mustChangePassword の判定で行う。
// ここでは、その判定と、作ったアカウントの効き目（ログイン・変更・選択肢・一覧・ほかの入口）を確かめる。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { MIN_PASSWORD_LENGTH, changePassword, createSession, getSessionUser, login, validatePasswordChangeInput } from "../src/lib/auth.ts";
import {
  CREATE_MEMBER_REFUSAL_MESSAGES,
  PASSWORD_CHANGE_REQUIRED_DETAIL,
  TEMPORARY_PASSWORD_LENGTH,
  createMember,
  generateTemporaryPassword,
  isCoordinator,
  listUserOptions,
  listUserSummaries,
  mustChangePassword,
  resumeUser,
  suspendUser,
  validateNewMemberInput,
} from "../src/lib/users.ts";
import { listAssigneeOptions, listMemberWorkload } from "../src/lib/members.ts";
import { validateTaskInput } from "../src/lib/task-validation.ts";
import { createTask } from "../src/lib/task-store.ts";
import { updateTasks, validateBulkUpdateInput } from "../src/lib/bulk-update.ts";
import { addMember, showAddMemberControl } from "../src/lib/member-create.ts";

type Db = ReturnType<typeof openDb>;
const NOW = new Date("2026-11-13T04:00:00.000Z");

function userCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

function create(db: Db, body: unknown = { userId: "yamada", name: "山田" }, actor = "tanaka") {
  const result = createMember(actor, body, db);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as Extract<typeof result, { ok: true }>;
}

describe("createMember: 取りまとめる人がアカウントを作る", () => {
  it("取りまとめる人は ID と名前でアカウントを作れ、役割はメンバーになる", () => {
    const db = openDb();
    const r = create(db);
    assert.deepEqual(r.user, { id: "yamada", name: "山田", role: "member" });
    const row = db.prepare("SELECT role, suspended_at FROM users WHERE id = 'yamada'").get() as { role: string; suspended_at: string | null };
    assert.equal(row.role, "member");
    assert.equal(row.suspended_at, null);
    assert.equal(isCoordinator("yamada", db), false);
  });

  it("名前は前後の空白を除いて保存する", () => {
    const db = openDb();
    const r = create(db, { userId: "yamada", name: "  山田 太郎　" });
    assert.equal(r.user.name, "山田 太郎");
    assert.equal(listUserSummaries(db).find((u) => u.id === "yamada")?.name, "山田 太郎");
  });

  it("メンバーは作れない（forbidden）。入力が誤っていても forbidden を先に返し、何も作らない", () => {
    const db = openDb();
    const before = userCount(db);
    assert.deepEqual(createMember("sato", { userId: "yamada", name: "山田" }, db), { ok: false, reason: "forbidden" });
    assert.deepEqual(createMember("sato", { userId: "Bad!", name: "" }, db), { ok: false, reason: "forbidden" });
    assert.deepEqual(createMember("nobody", { userId: "yamada", name: "山田" }, db), { ok: false, reason: "forbidden" });
    assert.equal(userCount(db), before);
    assert.equal(CREATE_MEMBER_REFUSAL_MESSAGES.forbidden, "メンバーを加えられるのは、取りまとめる人だけです");
  });

  it("停止した取りまとめる人は作れない", () => {
    const db = openDb();
    db.prepare("UPDATE users SET role = 'coordinator' WHERE id = 'suzuki'").run();
    assert.equal(suspendUser("suzuki", "tanaka", db, NOW).ok, true);
    assert.deepEqual(createMember("tanaka", { userId: "yamada", name: "山田" }, db), { ok: false, reason: "forbidden" });
  });

  it("ID がすでにあれば conflict で、元の行は変わらない", () => {
    const db = openDb();
    const before = db.prepare("SELECT * FROM users WHERE id = 'sato'").get();
    assert.deepEqual(createMember("tanaka", { userId: "sato", name: "別の人" }, db), { ok: false, reason: "conflict" });
    assert.deepEqual(db.prepare("SELECT * FROM users WHERE id = 'sato'").get(), before);
  });

  it("停止中の利用者の ID も conflict（停止中のまま、作り直さない）", () => {
    const db = openDb();
    suspendUser("tanaka", "sato", db, NOW);
    assert.deepEqual(createMember("tanaka", { userId: "sato", name: "佐藤" }, db), { ok: false, reason: "conflict" });
    assert.equal(listUserSummaries(db).find((u) => u.id === "sato")?.suspended, true);
  });

  it("同じ ID を続けて 2 回作ると、2 回目は conflict で 1 回目の仮のパスワードが使える", () => {
    const db = openDb();
    const first = create(db);
    assert.deepEqual(createMember("tanaka", { userId: "yamada", name: "山田 2" }, db), { ok: false, reason: "conflict" });
    assert.equal(login("yamada", first.temporaryPassword, db, NOW).ok, true);
    assert.equal(listUserSummaries(db).find((u) => u.id === "yamada")?.name, "山田");
  });

  it("入力の誤りは invalid で、理由を返し、何も作らない", () => {
    const db = openDb();
    const before = userCount(db);
    const r = createMember("tanaka", { userId: "", name: "" }, db);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "invalid");
    assert.ok(!r.ok && r.reason === "invalid" && r.errors.length === 2);
    assert.equal(userCount(db), before);
  });
});

describe("validateNewMemberInput: ID と名前の決まり", () => {
  const errorsOf = (body: unknown) => {
    const r = validateNewMemberInput(body);
    return r.ok ? [] : r.errors;
  };

  it("ID は英小文字・数字・-・_ で 3〜32 文字、先頭は英小文字", () => {
    for (const id of ["abc", "a".repeat(32), "yamada-taro", "yamada_2", "a1-_"]) {
      assert.deepEqual(errorsOf({ userId: id, name: "山田" }), [], id);
    }
  });

  it("ID が短すぎる（2 文字）・長すぎる（33 文字）は、文字数を直すよう伝える", () => {
    for (const id of ["ab", "a".repeat(33)]) {
      const errors = errorsOf({ userId: id, name: "山田" });
      assert.equal(errors.length, 1, id);
      assert.match(errors[0], /3〜32 文字にしてください/);
    }
  });

  it("ID の大文字・先頭の数字や記号・使えない文字は、使える文字を伝える（小文字にそろえない）", () => {
    for (const id of ["Yamada", "yamadA", "1yamada", "-yamada", "_yamada", "yama.da", "yama da", "やまだ太郎"]) {
      const errors = errorsOf({ userId: id, name: "山田" });
      assert.equal(errors.length, 1, id);
      assert.match(errors[0], /英小文字・数字・「-」・「_」だけ/, id);
    }
  });

  it("ID が空・文字列でない・無いときは、入力するよう伝える", () => {
    for (const id of ["", undefined, 123, null, ["abc"]]) {
      assert.deepEqual(errorsOf({ userId: id, name: "山田" }), ["ID を入力してください"], String(id));
    }
  });

  it("名前は前後の空白を除いて 1〜50 文字（絵文字は 1 文字）", () => {
    assert.deepEqual(errorsOf({ userId: "abc", name: "あ".repeat(50) }), []);
    assert.deepEqual(errorsOf({ userId: "abc", name: `  ${"あ".repeat(50)}  ` }), []);
    assert.deepEqual(errorsOf({ userId: "abc", name: "😀".repeat(50) }), []);
    const errors = errorsOf({ userId: "abc", name: "あ".repeat(51) });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /50 文字以内にしてください（今は 51 文字）/);
  });

  it("名前が空・空白だけ・文字列でないときは、入力するよう伝える", () => {
    for (const name of ["", "   ", "　", undefined, 5]) {
      assert.deepEqual(errorsOf({ userId: "abc", name }), ["名前を入力してください"], String(name));
    }
  });

  it("名前の改行・タブ・制御文字は断る（前後の改行は空白として除く）", () => {
    for (const name of ["山田\n太郎", "山田\r太郎", "山田\t太郎", "山田\u0000", "山田\u007f太郎", "山田\u2028太郎"]) {
      const errors = errorsOf({ userId: "abc", name });
      assert.equal(errors.length, 1, JSON.stringify(name));
      assert.match(errors[0], /改行や制御文字は使えません/);
    }
    assert.deepEqual(errorsOf({ userId: "abc", name: "\n山田\n" }), []);
  });

  it("知らない項目（role・password など）は断る", () => {
    const errors = errorsOf({ userId: "abc", name: "山田", role: "coordinator" });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /role は受け付けない項目です/);
    assert.equal(errorsOf({ userId: "abc", name: "山田", password: "x" }).length, 1);
  });

  it("本文がオブジェクトでなければ形式の誤り", () => {
    for (const body of [undefined, null, "abc", [], 1]) {
      const errors = errorsOf(body);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /リクエストの形式が正しくありません/);
    }
  });

  it("ID と名前の両方が誤っていれば、両方の理由を返す", () => {
    assert.equal(errorsOf({ userId: "A", name: "" }).length, 2);
  });
});

describe("仮のパスワード", () => {
  it("16 文字以上で、アプリのパスワードの決まり（最小の文字数）を満たす", () => {
    assert.ok(TEMPORARY_PASSWORD_LENGTH >= 16);
    for (let i = 0; i < 20; i++) {
      const p = generateTemporaryPassword();
      assert.equal(p.length, TEMPORARY_PASSWORD_LENGTH);
      assert.ok(p.length >= MIN_PASSWORD_LENGTH);
      assert.match(p, /^[A-Za-z0-9]+$/);
      // パスワード変更の検証（決まり）を、新しいパスワードとして通る
      assert.equal(validatePasswordChangeInput({ currentPassword: "x", newPassword: p }).ok, true);
    }
  });

  it("毎回違う値になる", () => {
    const set = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
    assert.equal(set.size, 50);
  });

  it("保存するのはハッシュだけで、平文は DB のどこにも残らない", () => {
    const db = openDb();
    const r = create(db);
    const row = db.prepare("SELECT * FROM users WHERE id = 'yamada'").get() as Record<string, unknown>;
    assert.match(String(row.password_hash), /^scrypt\$/);
    assert.ok(!JSON.stringify(row).includes(r.temporaryPassword));
  });

  it("一覧・担当者の選択肢には、仮のパスワードもハッシュも出ない", () => {
    const db = openDb();
    const r = create(db);
    for (const list of [listUserSummaries(db), listUserOptions(db), listAssigneeOptions(db, "2026-11-13")]) {
      const json = JSON.stringify(list);
      assert.ok(!json.includes(r.temporaryPassword));
      assert.ok(!json.includes("scrypt"));
      assert.ok(!json.includes("must_change"));
    }
  });
});

describe("仮のパスワードでのログインと変更", () => {
  it("仮のパスワードでログインでき、変更が要る状態になる。既存の利用者は要らない", () => {
    const db = openDb();
    const r = create(db);
    const result = login("yamada", r.temporaryPassword, db, NOW);
    assert.equal(result.ok, true);
    assert.equal(mustChangePassword("yamada", db), true);
    for (const id of ["sato", "suzuki", "tanaka", "nobody"]) assert.equal(mustChangePassword(id, db), false, id);
  });

  it("変更の間の API を断る理由は、変え方を伝える", () => {
    assert.match(PASSWORD_CHANGE_REQUIRED_DETAIL, /\/api\/password/);
  });

  it("仮のパスワードを今のパスワードにして変えると、止めが外れ、仮のパスワードではログインできなくなる", () => {
    const db = openDb();
    const r = create(db);
    const logged = login("yamada", r.temporaryPassword, db, NOW);
    assert.ok(logged.ok);
    const changed = changePassword("yamada", logged.token, { currentPassword: r.temporaryPassword, newPassword: "my-own-pass-1" }, db, NOW);
    assert.deepEqual(changed, { ok: true });
    assert.equal(mustChangePassword("yamada", db), false);
    assert.equal(login("yamada", r.temporaryPassword, db, NOW).ok, false);
    assert.equal(login("yamada", "my-own-pass-1", db, NOW).ok, true);
    // 変えたセッションはそのまま使える
    assert.equal(getSessionUser(logged.token, db, NOW)?.id, "yamada");
  });

  it("今のパスワードを誤ると変わらず、止めも残る", () => {
    const db = openDb();
    const r = create(db);
    const token = createSession("yamada", db, NOW);
    assert.deepEqual(changePassword("yamada", token, { currentPassword: "wrong-pass", newPassword: "my-own-pass-1" }, db, NOW), {
      ok: false,
      reason: "wrong-password",
    });
    assert.equal(mustChangePassword("yamada", db), true);
    assert.equal(login("yamada", r.temporaryPassword, db, NOW).ok, true);
  });

  it("新しいパスワードを仮のパスワードと同じにはできない（今の決まり）", () => {
    const db = openDb();
    const r = create(db);
    const v = validatePasswordChangeInput({ currentPassword: r.temporaryPassword, newPassword: r.temporaryPassword });
    assert.equal(v.ok, false);
  });

  it("既存の利用者がパスワードを変えても、変更が要る状態にはならない", () => {
    const db = openDb();
    const token = createSession("sato", db, NOW);
    assert.deepEqual(changePassword("sato", token, { currentPassword: "password", newPassword: "new-password-1" }, db, NOW), { ok: true });
    assert.equal(mustChangePassword("sato", db), false);
  });
});

describe("作ったメンバーは、ほかの入口からもすぐに使える", () => {
  it("担当者の選択肢・メンバーの一覧・GET /api/assignees（listUserOptions）・GET /api/users に出る", () => {
    const db = openDb();
    create(db);
    assert.ok(listUserOptions(db).some((u) => u.id === "yamada" && u.name === "山田"));
    assert.ok(listAssigneeOptions(db, "2026-11-13").some((o) => o.id === "yamada" && o.label === "山田（未完了 0）"));
    const row = listMemberWorkload(db, "2026-11-13").find((m) => m.id === "yamada");
    assert.equal(row?.openCount, 0);
    assert.equal(row?.suspended, false);
    assert.deepEqual(listUserSummaries(db).find((u) => u.id === "yamada"), { id: "yamada", name: "山田", suspended: false, role: "member" });
  });

  it("タスクの担当者にでき、まとめての変更でも担当者にできる", () => {
    const db = openDb();
    create(db);
    assert.equal(validateTaskInput({ title: "新しい作業", status: "todo", assignee: "yamada", dueDate: "2026-11-30" }, {}, db).ok, true);
    const task = createTask({ title: "引き継ぐ作業", status: "todo", assignee: "sato", dueDate: "2026-11-30" }, db);
    const input = validateBulkUpdateInput({ ids: [task.id], changes: { assignee: "yamada" } }, db);
    assert.equal(input.ok, true);
    updateTasks([task.id], { assignee: "yamada" }, db, "tanaka", NOW);
    assert.equal(listMemberWorkload(db, "2026-11-13").find((m) => m.id === "yamada")?.openCount, 1);
  });

  it("停止すると、仮のパスワードでもログインできない。再開しても、仮のパスワードの変更はまだ要る", () => {
    const db = openDb();
    const r = create(db);
    assert.equal(suspendUser("tanaka", "yamada", db, NOW).ok, true);
    assert.equal(login("yamada", r.temporaryPassword, db, NOW).ok, false);
    assert.equal(resumeUser("tanaka", "yamada", db).ok, true);
    assert.equal(mustChangePassword("yamada", db), true);
    assert.equal(login("yamada", r.temporaryPassword, db, NOW).ok, true);
  });

  it("作ったメンバーは、メンバーを加えられない", () => {
    const db = openDb();
    create(db);
    assert.deepEqual(createMember("yamada", { userId: "kimura", name: "木村" }, db), { ok: false, reason: "forbidden" });
  });
});

describe("メンバーの一覧の「メンバーを加える」", () => {
  it("取りまとめる人にだけ出す", () => {
    assert.equal(showAddMemberControl({ isCoordinator: true }), true);
    assert.equal(showAddMemberControl({ isCoordinator: false }), false);
  });

  it("作れたら、ID・名前・仮のパスワードを返す（POST /api/users に JSON で送る）", async () => {
    let sent: { url: string; body: string } | undefined;
    const result = await addMember("yamada", "山田", {
      fetch: async (url, init) => {
        sent = { url, body: init.body };
        return { ok: true, json: async () => ({ user: { id: "yamada", name: "山田", role: "member" }, temporaryPassword: "abcdefghijkmnpqrstu" }) };
      },
    });
    assert.deepEqual(sent, { url: "/api/users", body: JSON.stringify({ userId: "yamada", name: "山田" }) });
    assert.deepEqual(result, { status: "done", user: { id: "yamada", name: "山田" }, temporaryPassword: "abcdefghijkmnpqrstu" });
  });

  it("入力の誤りは details の理由を、409・403 は error を出す", async () => {
    const reply = (body: unknown) => ({ fetch: async () => ({ ok: false, json: async () => body }) });
    assert.deepEqual(await addMember("A", "", reply({ error: "入力内容に誤りがあります", details: ["理由 1", "理由 2"] })), {
      status: "error",
      messages: ["理由 1", "理由 2"],
    });
    assert.deepEqual(await addMember("sato", "佐藤", reply({ error: "その ID はすでに使われています" })), {
      status: "error",
      messages: ["その ID はすでに使われています"],
    });
  });

  it("通信できない・応答が読めないときは、作れなかったと伝える", async () => {
    assert.deepEqual(await addMember("yamada", "山田", { fetch: async () => { throw new Error("offline"); } }), {
      status: "error",
      messages: ["メンバーを加えられませんでした。"],
    });
    assert.deepEqual(
      await addMember("yamada", "山田", { fetch: async () => ({ ok: false, json: async () => { throw new Error("bad"); } }) }),
      { status: "error", messages: ["メンバーを加えられませんでした。"] },
    );
  });
});
