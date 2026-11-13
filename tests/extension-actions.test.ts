import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { approveResponse, createExtension, DECIDE_FORBIDDEN_MESSAGE, decideExtension, getExtension, listPendingExtensions } from "../src/lib/extensions.ts";
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
    if (out.result === "forbidden") return respond(403, { error: DECIDE_FORBIDDEN_MESSAGE[out.reason] });
    if (out.result === "conflict") return respond(409, { error: "この延長申請はすでに判断されています" });
    return respond(200, m[3] === "approve" ? approveResponse(out) : { extension: out.extension });
  };
  return { fetch, sent };
}

/** 佐藤の申請が 1 件ある DB。ほかの人が先に判断する場面を作れるよう、田中に加えて鈴木も取りまとめる人にする。 */
function setup() {
  const db = openDb();
  db.prepare("UPDATE users SET role = 'coordinator' WHERE id = 'suzuki'").run();
  const ext = createExtension({ taskId: 3, requester: "sato", newDueDate: "2026-11-30", reason: "レビュー待ち" }, db);
  if (ext === "conflict") throw new Error("setup");
  const row = listPendingExtensions(db).find((r) => r.id === ext.id)!;
  const target: DecidableExtension = {
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    requester: row.requester,
    newDueDate: row.newDueDate,
    alreadyExtended: row.alreadyExtended,
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
  it("自分が出した申請の行には、取りまとめる人でも承認・却下のボタンを出さない", () => {
    assert.equal(canDecideExtension("tanaka", "tanaka", true), false);
    assert.equal(canDecideExtension("sato", "sato", false), false);
  });

  it("取りまとめる人には、ほかの人の申請の行に出す（ID で比べ、表示名が同じでも ID が違えば出す）", () => {
    assert.equal(canDecideExtension("sato", "tanaka", true), true);
    assert.equal(canDecideExtension("田中", "tanaka", true), true);
  });

  it("取りまとめる人でなければ、ほかの人の申請の行にも出さない", () => {
    assert.equal(canDecideExtension("sato", "suzuki", false), false);
    assert.equal(canDecideExtension("tanaka", "suzuki", false), false);
  });
});

describe("一覧から承認・却下する: 取りまとめる人でないとき", () => {
  for (const decision of ["approve", "reject"] as const) {
    it(`画面を通さずに ${decision} しようとしても断られて理由が出て、申請も期限も変わらない`, async () => {
      const { db, target } = setup();
      db.prepare("UPDATE users SET role = 'member' WHERE id = 'suzuki'").run();
      const taskBefore = getTask(3, db);
      const extBefore = getExtension(target.id, db);
      const api = apiFetch(db, "suzuki");
      const result = await confirmAndDecideExtension(target, decision, { confirm: () => true, fetch: api.fetch });
      assert.deepEqual(result, { status: "error", message: DECIDE_FORBIDDEN_MESSAGE.not_coordinator, reload: false });
      assert.deepEqual(getTask(3, db), taskBefore);
      assert.deepEqual(getExtension(target.id, db), extBefore);
    });
  }
});

describe("一覧から承認する: 申請の後でタスクの期限が希望の期限以降に変わっていたとき（#505）", () => {
  /** 佐藤の申請（希望 2026-11-30）の後で、タスク 3 の期限を dueDate に変え、一覧を開き直した行を返す。 */
  function reopened(dueDate: string) {
    const { db, target } = setup();
    db.prepare("UPDATE tasks SET due_date = ? WHERE id = 3").run(dueDate);
    const row = listPendingExtensions(db).find((r) => r.id === target.id)!;
    return { db, target: { ...target, alreadyExtended: row.alreadyExtended } };
  }

  it("一覧の行で、承認しても期限が変わらないことが分かる（後ろ・同じ日）。前に変わったときは出さない", () => {
    assert.equal(reopened("2026-12-12").target.alreadyExtended, true);
    assert.equal(reopened("2026-11-30").target.alreadyExtended, true);
    assert.equal(reopened("2026-11-29").target.alreadyExtended, false);
    assert.equal(reopened("2026-11-01").target.alreadyExtended, false);
    assert.equal(setup().target.alreadyExtended, false); // 申請のときのまま
  });

  it("確認のダイアログで、期限は変えずに承認すると分かる。却下の文言は変わらない", () => {
    const { target } = reopened("2026-12-12");
    const m = decideConfirmMessage(target, "approve");
    assert.ok(m.includes("すでに希望の期限（2026-11-30）以降"), m);
    assert.ok(m.includes("期限は変えずに"), m);
    assert.equal(decideConfirmMessage(target, "reject"), decideConfirmMessage({ ...target, alreadyExtended: false }, "reject"));
  });

  it("承認すると、期限は縮まず、承認として閉じ、理由がメッセージに出る", async () => {
    const { db, target } = reopened("2026-12-12");
    const api = apiFetch(db, "tanaka");
    const result = await confirmAndDecideExtension(target, "approve", { confirm: () => true, fetch: api.fetch });
    assert.deepEqual(result, {
      status: "decided",
      message: "タスクの期限（2026-12-12）がすでに希望の期限（2026-11-30）以降のため、期限は変えずに承認しました",
    });
    assert.equal(getTask(3, db)!.dueDate, "2026-12-12");
    assert.equal(getExtension(target.id, db)!.status, "approved");
    assert.equal(listPendingExtensions(db).some((r) => r.id === target.id), false);
  });

  it("一覧を開いた後で期限が後ろへ変わっても、承認の結果のメッセージで分かる", async () => {
    const { db, target } = setup(); // 一覧を開いたときは、まだ期限が希望より前
    assert.equal(target.alreadyExtended, false);
    db.prepare("UPDATE tasks SET due_date = '2026-12-12' WHERE id = 3").run();
    const api = apiFetch(db, "tanaka");
    const result = await confirmAndDecideExtension(target, "approve", { confirm: () => true, fetch: api.fetch });
    assert.equal(result.status, "decided");
    assert.ok(result.status === "decided" && result.message.includes("期限は変えずに承認しました"));
    assert.equal(getTask(3, db)!.dueDate, "2026-12-12");
  });

  it("期限が希望の期限より前に変わっていたら、今と同じく希望の期限にし「承認しました」と出る", async () => {
    const { db, target } = reopened("2026-11-20");
    const api = apiFetch(db, "tanaka");
    const result = await confirmAndDecideExtension(target, "approve", { confirm: () => true, fetch: api.fetch });
    assert.deepEqual(result, { status: "decided", message: "承認しました" });
    assert.equal(getTask(3, db)!.dueDate, "2026-11-30");
  });
});
