// 取りまとめる人が、メンバーのログインを停止・再開できる（#522）。
// API Route（src/app/api/users/[id]/suspension/route.ts など）は next/server を読み込むため単体テストから呼べない。
// ルートは、ログインの確認の後に suspendUser・resumeUser の結果をそのまま応答の番号（403・404・400・200）にする。
// ここでは、その判定と、停止したときの効き目（ログイン・セッション・選択肢・記録）を確かめる。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, openDb } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { createSession, getSessionUser, login } from "../src/lib/auth.ts";
import {
  isSuspended,
  listUserOptions,
  listUserSummaries,
  listUsers,
  resumeUser,
  suspendUser,
  SUSPENSION_REFUSAL_MESSAGES,
} from "../src/lib/users.ts";
import { listAssigneeOptions, listMemberWorkload } from "../src/lib/members.ts";
import { buildAssigneeFilterOptions } from "../src/lib/task-filter-form.ts";
import { updateTasks, validateBulkUpdateInput } from "../src/lib/bulk-update.ts";
import { undoBulkUpdate } from "../src/lib/bulk-undo.ts";
import {
  createTask,
  duplicateTaskForRequest,
  getTask,
  listTasks,
  SUSPENDED_ASSIGNEE_ERROR,
  updateTask,
  validateTaskInput,
} from "../src/lib/tasks.ts";
import { createComment, listComments } from "../src/lib/comments.ts";
import { formatAssigneeChange, listAssigneeChanges } from "../src/lib/assignee-history.ts";
import { createExtension, listPendingExtensions } from "../src/lib/extensions.ts";
import { setMemberSuspended, showSuspensionControl } from "../src/lib/member-suspension.ts";

type Db = ReturnType<typeof openDb>;
const NOW = new Date("2026-11-13T04:00:00.000Z");

function suspend(db: Db, target: string, actor = "tanaka") {
  const r = suspendUser(actor, target, db, NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
}

const loginOk = (db: Db, userId: string) => login(userId, SEED_PASSWORD, db, NOW).ok;
const sessionCount = (db: Db, userId: string) =>
  (db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(userId) as { n: number }).n;

describe("取りまとめる人が、停止・再開できる", () => {
  it("田中（取りまとめる人）が鈴木を停止すると、停止中になり、再開すると戻る", () => {
    const db = openDb();
    const stopped = suspendUser("tanaka", "suzuki", db, NOW);
    assert.deepEqual(stopped, { ok: true, user: { id: "suzuki", name: "鈴木", suspended: true } });
    assert.equal(isSuspended("suzuki", db), true);
    const resumed = resumeUser("tanaka", "suzuki", db);
    assert.deepEqual(resumed, { ok: true, user: { id: "suzuki", name: "鈴木", suspended: false } });
    assert.equal(isSuspended("suzuki", db), false);
  });

  it("停止済みをもう一度停止しても成功し、停止した日時は最初のまま。停止していない人の再開も成功する", () => {
    const db = openDb();
    suspend(db, "suzuki");
    suspendUser("tanaka", "suzuki", db, new Date("2026-11-20T00:00:00.000Z"));
    const row = db.prepare("SELECT suspended_at FROM users WHERE id = 'suzuki'").get() as { suspended_at: string };
    assert.equal(row.suspended_at, NOW.toISOString());
    assert.equal(resumeUser("tanaka", "sato", db).ok, true);
    assert.equal(isSuspended("sato", db), false);
  });

  it("停止→再開→停止 と行き来しても、そのたびに効く", () => {
    const db = openDb();
    suspend(db, "suzuki");
    assert.equal(loginOk(db, "suzuki"), false);
    resumeUser("tanaka", "suzuki", db);
    assert.equal(loginOk(db, "suzuki"), true);
    suspend(db, "suzuki");
    assert.equal(loginOk(db, "suzuki"), false);
    assert.equal(sessionCount(db, "suzuki"), 0);
  });

  it("存在しない利用者は not_found（404）", () => {
    const db = openDb();
    assert.deepEqual(suspendUser("tanaka", "nobody", db, NOW), { ok: false, reason: "not_found" });
    assert.deepEqual(resumeUser("tanaka", "nobody", db), { ok: false, reason: "not_found" });
  });
});

describe("取りまとめる人でない人は、停止・再開できない（403）", () => {
  it("メンバー（佐藤）が停止・再開を呼ぶと forbidden。相手がいない ID でも forbidden（相手の有無を漏らさない）", () => {
    const db = openDb();
    assert.deepEqual(suspendUser("sato", "suzuki", db, NOW), { ok: false, reason: "forbidden" });
    assert.deepEqual(suspendUser("sato", "nobody", db, NOW), { ok: false, reason: "forbidden" });
    suspend(db, "suzuki");
    assert.deepEqual(resumeUser("sato", "suzuki", db), { ok: false, reason: "forbidden" });
    assert.equal(isSuspended("suzuki", db), true);
    assert.match(SUSPENSION_REFUSAL_MESSAGES.forbidden, /取りまとめる人だけ/);
  });

  it("停止された取りまとめる人は、もう停止・再開できない", () => {
    const db = openDb();
    db.prepare("UPDATE users SET role = 'coordinator' WHERE id = 'sato'").run();
    suspend(db, "tanaka", "sato");
    assert.deepEqual(resumeUser("tanaka", "tanaka", db), { ok: false, reason: "forbidden" });
    assert.deepEqual(suspendUser("tanaka", "sato", db, NOW), { ok: false, reason: "forbidden" });
  });

  it("画面の操作は、取りまとめる人にだけ、自分以外の行に出る", () => {
    assert.equal(showSuspensionControl({ id: "tanaka", isCoordinator: true }, "suzuki"), true);
    assert.equal(showSuspensionControl({ id: "tanaka", isCoordinator: true }, "tanaka"), false);
    assert.equal(showSuspensionControl({ id: "sato", isCoordinator: false }, "suzuki"), false);
    assert.equal(showSuspensionControl({ id: "sato", isCoordinator: false }, "sato"), false);
  });
});

describe("自分自身・ただ 1 人の取りまとめる人は停止できない", () => {
  it("自分自身は self（400）。再開も self", () => {
    const db = openDb();
    assert.deepEqual(suspendUser("tanaka", "tanaka", db, NOW), { ok: false, reason: "self" });
    assert.deepEqual(resumeUser("tanaka", "tanaka", db), { ok: false, reason: "self" });
    assert.equal(isSuspended("tanaka", db), false);
  });

  it("取りまとめる人が 1 人だけのとき、その人を停止できる人はいない（本人は self、メンバーは forbidden）", () => {
    const db = openDb();
    assert.equal(suspendUser("tanaka", "tanaka", db, NOW).ok, false);
    assert.equal(suspendUser("sato", "tanaka", db, NOW).ok, false);
    assert.equal(isSuspended("tanaka", db), false);
  });

  it("取りまとめる人が 2 人なら、もう 1 人を停止できる。そのあと残った 1 人は停止できない", () => {
    const db = openDb();
    db.prepare("UPDATE users SET role = 'coordinator' WHERE id = 'sato'").run();
    suspend(db, "tanaka", "sato");
    assert.equal(suspendUser("sato", "sato", db, NOW).ok, false);
    assert.equal(isSuspended("sato", db), false);
  });

  it("停止された取りまとめる人を、残った取りまとめる人が再開できる", () => {
    const db = openDb();
    db.prepare("UPDATE users SET role = 'coordinator' WHERE id = 'sato'").run();
    suspend(db, "tanaka", "sato");
    assert.equal(resumeUser("sato", "tanaka", db).ok, true);
    assert.equal(loginOk(db, "tanaka"), true);
  });
});

describe("停止したメンバーは、ログインできない", () => {
  it("正しいパスワードでも、ほかの失敗と同じ invalid で断られ、セッションは作られない", () => {
    const db = openDb();
    suspend(db, "suzuki");
    const result = login("suzuki", SEED_PASSWORD, db, NOW);
    assert.deepEqual(result, { ok: false, reason: "invalid" });
    assert.deepEqual(login("suzuki", "wrong-password", db, NOW), { ok: false, reason: "invalid" });
    assert.deepEqual(login("nobody", SEED_PASSWORD, db, NOW), { ok: false, reason: "invalid" });
    assert.equal(sessionCount(db, "suzuki"), 0);
  });

  it("ほかの人のログインには影響しない", () => {
    const db = openDb();
    suspend(db, "suzuki");
    assert.equal(loginOk(db, "sato"), true);
    assert.equal(loginOk(db, "tanaka"), true);
  });
});

describe("停止した時点で、ログイン中のセッションがすべて切れる", () => {
  it("複数の端末のセッションが消え、次の要求は未ログイン（401）として扱われる", () => {
    const db = openDb();
    const a = createSession("suzuki", db, NOW);
    const b = createSession("suzuki", db, NOW);
    const other = createSession("sato", db, NOW);
    assert.equal(getSessionUser(a, db, NOW)?.id, "suzuki");
    suspend(db, "suzuki");
    assert.equal(getSessionUser(a, db, NOW), undefined);
    assert.equal(getSessionUser(b, db, NOW), undefined);
    assert.equal(sessionCount(db, "suzuki"), 0);
    assert.equal(getSessionUser(other, db, NOW)?.id, "sato");
  });

  it("停止した人のセッションが残っていても、ログイン中として扱わない", () => {
    const db = openDb();
    const token = createSession("suzuki", db, NOW);
    db.prepare("UPDATE users SET suspended_at = ? WHERE id = 'suzuki'").run(NOW.toISOString());
    assert.equal(getSessionUser(token, db, NOW), undefined);
  });

  it("再開しても、切れたセッションは戻らない（ログインし直す）", () => {
    const db = openDb();
    const token = createSession("suzuki", db, NOW);
    suspend(db, "suzuki");
    resumeUser("tanaka", "suzuki", db);
    assert.equal(getSessionUser(token, db, NOW), undefined);
  });
});

describe("停止したメンバーは、担当者の選択肢に出ず、一覧には停止中と出る", () => {
  it("新しいタスク・まとめての変更の選択肢と GET /api/assignees に出ない", () => {
    const db = openDb();
    suspend(db, "suzuki");
    assert.deepEqual(listAssigneeOptions(db, "2026-11-13").map((o) => o.id), ["sato", "tanaka"]);
    assert.deepEqual(listUserOptions(db).map((u) => u.id), ["sato", "tanaka"]);
  });

  it("担当の変更の選択肢には、今の担当者が停止していればその人だけを（停止中）付きで残す", () => {
    const db = openDb();
    suspend(db, "suzuki");
    const forSuzukiTask = listAssigneeOptions(db, "2026-11-13", "suzuki");
    assert.deepEqual(forSuzukiTask.map((o) => o.id), ["sato", "suzuki", "tanaka"]);
    assert.equal(forSuzukiTask.find((o) => o.id === "suzuki")?.label, "鈴木（停止中）");
    assert.deepEqual(listAssigneeOptions(db, "2026-11-13", "sato").map((o) => o.id), ["sato", "tanaka"]);
  });

  it("担当のタスクが無い人を停止しても、選択肢に出ない", () => {
    const db = openDb();
    db.prepare("UPDATE tasks SET assignee = 'sato' WHERE assignee = 'suzuki'").run();
    suspend(db, "suzuki");
    assert.ok(!listAssigneeOptions(db, "2026-11-13").some((o) => o.id === "suzuki"));
  });

  it("メンバーの一覧と GET /api/users には全員が出て、停止した人は suspended になる", () => {
    const db = openDb();
    suspend(db, "suzuki");
    assert.deepEqual(listUserSummaries(db), [
      { id: "sato", name: "佐藤", suspended: false, role: "member" },
      { id: "suzuki", name: "鈴木", suspended: true, role: "member" },
      { id: "tanaka", name: "田中", suspended: false, role: "coordinator" },
    ]);
    const rows = listMemberWorkload(db, "2026-11-13");
    assert.deepEqual(rows.map((r) => [r.id, r.suspended]), [["sato", false], ["suzuki", true], ["tanaka", false]]);
  });

  it("GET /api/users はパスワードのハッシュなどを含めない", () => {
    const db = openDb();
    suspend(db, "suzuki");
    for (const u of listUserSummaries(db)) assert.deepEqual(Object.keys(u).sort(), ["id", "name", "role", "suspended"]);
  });

  it("一覧の絞り込みには残り、名前に（停止中）が付く（引き継ぐタスクを探せる）", () => {
    const db = openDb();
    suspend(db, "suzuki");
    const options = buildAssigneeFilterOptions(["suzuki"], db);
    const suzuki = options.find((o) => o.value === "suzuki");
    assert.deepEqual(suzuki, { value: "suzuki", label: "鈴木（停止中）", checked: true });
    assert.ok(listTasks({ assignees: ["suzuki"] }, db).length > 0);
  });

  it("再開すると、選択肢と GET /api/assignees に戻る", () => {
    const db = openDb();
    suspend(db, "suzuki");
    resumeUser("tanaka", "suzuki", db);
    assert.deepEqual(listAssigneeOptions(db, "2026-11-13").map((o) => o.id), ["sato", "suzuki", "tanaka"]);
    assert.deepEqual(listUserOptions(db).map((u) => u.id), ["sato", "suzuki", "tanaka"]);
    assert.equal(buildAssigneeFilterOptions([], db).find((o) => o.value === "suzuki")?.label, "鈴木");
  });
});

describe("停止したメンバーの記録は残り、名前も出る", () => {
  it("担当のタスク・コメント・担当者の履歴・延長の申請が残り、名前が出る", () => {
    const db = openDb();
    const task = createTask({ title: "引き継ぐ作業", status: "todo", assignee: "suzuki", dueDate: "2026-11-30" }, db);
    createComment({ taskId: task.id, author: "suzuki", body: "途中まで進めました" }, db, NOW);
    const ext = createExtension({ taskId: task.id, requester: "suzuki", newDueDate: "2026-12-05", reason: "待ち" }, db, NOW);
    assert.notEqual(ext, "conflict");
    updateTask(task.id, { assignee: "sato" }, db, "tanaka");
    updateTask(task.id, { assignee: "suzuki" }, db, "tanaka");
    suspend(db, "suzuki");

    assert.equal(getTask(task.id, db)?.assignee, "suzuki");
    assert.equal(listComments(task.id, db)[0].authorName, "鈴木");
    const history = listAssigneeChanges(task.id, db).map(formatAssigneeChange);
    assert.ok(history.some((h) => h.includes("鈴木")), history.join("\n"));
    assert.equal(listPendingExtensions(db).find((e) => e.taskId === task.id)?.requesterName, "鈴木");
    assert.ok(listUsers(db).some((u) => u.id === "suzuki" && u.name === "鈴木"));
  });
});

describe("停止したメンバーを担当者にするタスクの作成・更新は 400", () => {
  it("作成（POST /api/tasks）で停止した人を担当者にすると誤り", () => {
    const db = openDb();
    suspend(db, "suzuki");
    const r = validateTaskInput({ title: "新しい作業", status: "todo", assignee: "suzuki", dueDate: "2026-11-30" }, {}, db);
    assert.deepEqual(r, { ok: false, errors: [SUSPENDED_ASSIGNEE_ERROR] });
  });

  it("更新（PATCH /api/tasks/:id）で停止した人へ担当を替えると誤り", () => {
    const db = openDb();
    suspend(db, "suzuki");
    const r = validateTaskInput({ assignee: "suzuki" }, { partial: true, currentAssignee: "sato" }, db);
    assert.deepEqual(r, { ok: false, errors: [SUSPENDED_ASSIGNEE_ERROR] });
  });

  it("担当を変えずに（今の担当者のまま）ほかの項目を直すのは通す", () => {
    const db = openDb();
    suspend(db, "suzuki");
    const r = validateTaskInput({ title: "直した題名", assignee: "suzuki" }, { partial: true, currentAssignee: "suzuki" }, db);
    assert.equal(r.ok, true);
    assert.equal(validateTaskInput({ title: "直した題名" }, { partial: true, currentAssignee: "suzuki" }, db).ok, true);
  });

  it("まとめての変更（POST /api/tasks/bulk-update）で停止した人へ替えると誤り。ステータスだけなら通す", () => {
    const db = openDb();
    suspend(db, "suzuki");
    const r = validateBulkUpdateInput({ ids: [1, 2], changes: { assignee: "suzuki" } }, db);
    assert.deepEqual(r, { ok: false, errors: [SUSPENDED_ASSIGNEE_ERROR] });
    assert.equal(validateBulkUpdateInput({ ids: [2, 5], changes: { status: "done" } }, db).ok, true);
  });

  it("複製（POST /api/tasks/:id/duplicate）で、元の担当者が停止していれば複製しない", () => {
    const db = openDb();
    const suzukiTask = listTasks({ assignees: ["suzuki"] }, db)[0];
    const before = listTasks({}, db).length;
    suspend(db, "suzuki");
    assert.deepEqual(duplicateTaskForRequest(suzukiTask.id, db), { ok: false, reason: "suspended_assignee" });
    assert.equal(listTasks({}, db).length, before);
    const satoTask = listTasks({ assignees: ["sato"] }, db)[0];
    assert.equal(duplicateTaskForRequest(satoTask.id, db).ok, true);
    assert.deepEqual(duplicateTaskForRequest(99999, db), { ok: false, reason: "not_found" });
  });

  it("まとめての変更を元に戻すとき、停止した人へは戻さない（戻せなかったものに入る）", () => {
    const db = openDb();
    const ids = listTasks({ assignees: ["suzuki"] }, db).map((t) => t.id);
    const result = updateTasks(ids, { assignee: "sato" }, db, "tanaka", NOW);
    assert.ok(result.ok && result.undo);
    suspend(db, "suzuki");
    const undone = undoBulkUpdate(result.undo!.id, "tanaka", db, new Date(NOW.getTime() + 1000));
    assert.deepEqual(undone, { ok: true, restoredIds: [], skippedIds: [...ids].sort((a, b) => a - b) });
    for (const id of ids) assert.equal(getTask(id, db)?.assignee, "sato");
  });

  it("元に戻す変更がステータスだけなら、担当者が停止していても戻せる", () => {
    const db = openDb();
    const ids = listTasks({ assignees: ["suzuki"] }, db).filter((t) => t.status !== "done").map((t) => t.id);
    const result = updateTasks(ids, { status: "done" }, db, "tanaka", NOW);
    assert.ok(result.ok && result.undo);
    suspend(db, "suzuki");
    const undone = undoBulkUpdate(result.undo!.id, "tanaka", db, new Date(NOW.getTime() + 1000));
    assert.ok(undone.ok);
    assert.deepEqual(undone.ok && undone.restoredIds.length, ids.length);
  });

  it("再開すると、また担当者にできる", () => {
    const db = openDb();
    suspend(db, "suzuki");
    resumeUser("tanaka", "suzuki", db);
    const r = validateTaskInput({ title: "新しい作業", status: "todo", assignee: "suzuki", dueDate: "2026-11-30" }, {}, db);
    assert.equal(r.ok, true);
  });
});

describe("停止・再開のボタンの通信", () => {
  it("停止は POST、再開は DELETE で送り、失敗したら API の文言を返す", async () => {
    const calls: { url: string; method: string }[] = [];
    const ok = await setMemberSuspended("suzuki", true, {
      fetch: async (url, init) => {
        calls.push({ url, method: init.method });
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.deepEqual(ok, { status: "done", suspended: true });
    await setMemberSuspended("suzuki", false, {
      fetch: async (url, init) => {
        calls.push({ url, method: init.method });
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.deepEqual(calls, [
      { url: "/api/users/suzuki/suspension", method: "POST" },
      { url: "/api/users/suzuki/suspension", method: "DELETE" },
    ]);
    const ng = await setMemberSuspended("tanaka", true, {
      fetch: async () => ({ ok: false, json: async () => ({ error: SUSPENSION_REFUSAL_MESSAGES.self }) }),
    });
    assert.deepEqual(ng, { status: "error", message: SUSPENSION_REFUSAL_MESSAGES.self });
    const down = await setMemberSuspended("suzuki", false, { fetch: async () => { throw new Error("offline"); } });
    assert.deepEqual(down, { status: "error", message: "ログインを再開できませんでした。" });
  });
});

describe("マイグレーション", () => {
  it("前からある DB の利用者は、だれも停止していない状態から始まる", () => {
    const old = new DatabaseSync(":memory:");
    migrate(old, MIGRATIONS.filter((m) => m.version < 28));
    old.exec("INSERT INTO users (id, name) VALUES ('sato', '佐藤'), ('yamada', '山田')");
    migrate(old);
    assert.deepEqual(listUserSummaries(old).map((u) => u.suspended), [false, false]);
  });
});
