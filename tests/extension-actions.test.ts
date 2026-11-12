import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createExtension, decideExtension, getExtension, listPendingExtensions } from "../src/lib/extensions.ts";
import {
  ALREADY_DECIDED_MESSAGE,
  canDecideExtension,
  confirmAndDecideExtension,
  decideConfirmMessage,
  type DecidableExtension,
} from "../src/lib/extension-actions.ts";
import { getTask } from "../src/lib/tasks.ts";

// シードのタスク 3 は sato が担当、期限 2026-11-14。

type Db = ReturnType<typeof openDb>;

/** 承認・却下の API と同じ判定（401 は除く）を DB に対して行う、テスト用の通信。送った URL を記録する。 */
function apiFetch(db: Db, userId: string) {
  const sent: string[] = [];
  const fetch = async (url: string) => {
    sent.push(url);
    const m = url.match(/^\/api\/tasks\/(\d+)\/extensions\/(\d+)\/(approve|reject)$/);
    if (!m) throw new Error(`unexpected url ${url}`);
    const taskId = Number(m[1]);
    const respond = (status: number, body: unknown) => ({ ok: status === 200, status, json: async () => body });
    if (!getTask(taskId, db)) return respond(404, { error: "タスクが見つかりません" });
    const out = decideExtension(taskId, Number(m[2]), m[3] === "approve" ? "approved" : "rejected", userId, db);
    if (out.result === "not_found") return respond(404, { error: "延長申請が見つかりません" });
    if (out.result === "forbidden") return respond(403, { error: "自分の申請は判断できません" });
    if (out.result === "conflict") return respond(409, { error: "この延長申請はすでに判断されています" });
    return respond(200, { extension: out.extension });
  };
  return { fetch, sent };
}

function setup() {
  const db = openDb();
  const ext = createExtension({ taskId: 3, requester: "sato", newDueDate: "2026-11-30", reason: "レビュー待ち" }, db);
  if (ext === "conflict") throw new Error("setup");
  const row = listPendingExtensions(db).find((r) => r.id === ext.id)!;
  const target: DecidableExtension = {
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    requester: row.requester,
    newDueDate: row.newDueDate,
  };
  return { db, target };
}

describe("一覧から承認・却下する", () => {
  it("承認すると「承認しました」で、一覧から消え、タスクの期限が希望の期限になる", async () => {
    const { db, target } = setup();
    const api = apiFetch(db, "suzuki");
    const result = await confirmAndDecideExtension(target, "approve", { confirm: () => true, fetch: api.fetch });
    assert.deepEqual(result, { status: "decided", message: "承認しました" });
    assert.deepEqual(api.sent, [`/api/tasks/3/extensions/${target.id}/approve`]);
    assert.equal(listPendingExtensions(db).some((r) => r.id === target.id), false);
    assert.equal(getTask(3, db)!.dueDate, "2026-11-30");
  });

  it("却下すると「却下しました」で、一覧から消え、タスクの期限は変わらない", async () => {
    const { db, target } = setup();
    const before = getTask(3, db)!.dueDate;
    const api = apiFetch(db, "tanaka");
    const result = await confirmAndDecideExtension(target, "reject", { confirm: () => true, fetch: api.fetch });
    assert.deepEqual(result, { status: "decided", message: "却下しました" });
    assert.deepEqual(api.sent, [`/api/tasks/3/extensions/${target.id}/reject`]);
    assert.equal(listPendingExtensions(db).some((r) => r.id === target.id), false);
    assert.equal(getTask(3, db)!.dueDate, before);
    assert.equal(getExtension(target.id, db)!.status, "rejected");
  });

  it("確認のダイアログでキャンセルすると、何も送らず、申請も期限も変わらない", async () => {
    for (const decision of ["approve", "reject"] as const) {
      const { db, target } = setup();
      const taskBefore = getTask(3, db);
      const api = apiFetch(db, "suzuki");
      const asked: string[] = [];
      const result = await confirmAndDecideExtension(target, decision, {
        confirm: (m) => (asked.push(m), false),
        fetch: api.fetch,
      });
      assert.deepEqual(result, { status: "cancelled" });
      assert.deepEqual(asked, [decideConfirmMessage(target, decision)]);
      assert.deepEqual(api.sent, []);
      assert.equal(getExtension(target.id, db)!.status, "pending");
      assert.deepEqual(getTask(3, db), taskBefore);
    }
  });

  it("確認のダイアログに、タスクの題名と希望の期限が出る", () => {
    const { target } = setup();
    for (const decision of ["approve", "reject"] as const) {
      const m = decideConfirmMessage(target, decision);
      assert.ok(m.includes(target.taskTitle), m);
      assert.ok(m.includes("2026-11-30"), m);
    }
    assert.ok(decideConfirmMessage(target, "approve").includes("承認"));
    assert.ok(decideConfirmMessage(target, "reject").includes("却下"));
  });

  it("ほかの人が先に判断していたら「すでに判断されています」と出て、一覧を読み込み直す。期限は先の判断のまま", async () => {
    for (const decision of ["approve", "reject"] as const) {
      const { db, target } = setup();
      decideExtension(3, target.id, "rejected", "tanaka", db);
      const before = getTask(3, db);
      const api = apiFetch(db, "suzuki");
      const result = await confirmAndDecideExtension(target, decision, { confirm: () => true, fetch: api.fetch });
      assert.deepEqual(result, { status: "error", message: ALREADY_DECIDED_MESSAGE, reload: true });
      assert.ok(ALREADY_DECIDED_MESSAGE.includes("すでに判断されています"));
      assert.deepEqual(getTask(3, db), before);
      assert.equal(getExtension(target.id, db)!.decidedBy, "tanaka");
    }
  });

  it("見ている間に申請やタスクが消えていたら、理由を出して一覧を読み込み直す", async () => {
    const { db, target } = setup();
    db.prepare("DELETE FROM due_date_extensions WHERE id = ?").run(target.id);
    const api = apiFetch(db, "suzuki");
    const result = await confirmAndDecideExtension(target, "approve", { confirm: () => true, fetch: api.fetch });
    assert.deepEqual(result, { status: "error", message: "延長申請が見つかりません", reload: true });
  });

  it("画面を通さずに本人が判断しようとしても断られ、理由が出る（読み込み直しはしない）", async () => {
    const { db, target } = setup();
    const before = getTask(3, db);
    const api = apiFetch(db, "sato");
    const result = await confirmAndDecideExtension(target, "approve", { confirm: () => true, fetch: api.fetch });
    assert.deepEqual(result, { status: "error", message: "自分の申請は判断できません", reload: false });
    assert.equal(getExtension(target.id, db)!.status, "pending");
    assert.deepEqual(getTask(3, db), before);
  });

  it("通信に失敗したら、成功とは出さずに日本語の理由を出す", async () => {
    const { target } = setup();
    const failing = async () => {
      throw new Error("network");
    };
    assert.deepEqual(await confirmAndDecideExtension(target, "approve", { confirm: () => true, fetch: failing }), {
      status: "error",
      message: "承認できませんでした。",
      reload: false,
    });
    const broken = async () => ({ ok: false, status: 500, json: async () => Promise.reject(new Error("not json")) });
    assert.deepEqual(await confirmAndDecideExtension(target, "reject", { confirm: () => true, fetch: broken }), {
      status: "error",
      message: "却下できませんでした。",
      reload: false,
    });
  });
});

describe("canDecideExtension", () => {
  it("自分が出した申請の行には、承認・却下のボタンを出さない", () => {
    assert.equal(canDecideExtension("sato", "sato"), false);
  });

  it("ほかの人の申請の行には出す（ID で比べ、表示名が同じでも ID が違えば出す）", () => {
    assert.equal(canDecideExtension("sato", "suzuki"), true);
    assert.equal(canDecideExtension("佐藤", "sato"), true);
  });
});
