import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { listAssigneeChanges } from "../src/lib/assignee-history.ts";
import {
  bulkUndoDoneMessage,
  bulkUndoOfferMessage,
  confirmAndBulkUpdate,
  parseUndoOffer,
  requestBulkUndo,
} from "../src/lib/bulk-select.ts";
import { BULK_UNDO_WINDOW_MS, bulkUndoRefusal, undoBulkUpdate, validateBulkUndoInput } from "../src/lib/bulk-undo.ts";
import { updateTasks, validateBulkUpdateInput } from "../src/lib/bulk-update.ts";
import { deleteTask, getTask, updateTask, updateTaskIfUnchanged } from "../src/lib/tasks.ts";

// まとめて変えた担当者・ステータスを元に戻す（#401）。
// 初期データの担当者: 1 sato、2 suzuki、3 sato、4 tanaka、5 suzuki、6 sato、7 tanaka。

const T0 = new Date("2026-11-12T03:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function snapshot(db: Db, ids: number[]) {
  return ids.map((id) => {
    const t = getTask(id, db)!;
    return { id, status: t.status, assignee: t.assignee, completedAt: t.completedAt };
  });
}

function bulk(db: Db, ids: number[], changes: Parameters<typeof updateTasks>[1], by = "sato", now = T0) {
  const r = updateTasks(ids, changes, db, by, now);
  assert.ok(r.ok);
  assert.ok(r.undo);
  return r.undo;
}

describe("まとめての変更を元に戻す", () => {
  it("担当者とステータスをまとめて変えたあと、元に戻すと変える前の値（完了日時も）に戻る", () => {
    const db = openDb();
    const ids = [1, 2, 4, 5];
    updateTask(5, { status: "done" }, db); // 5 は完了済み（完了日時あり）から始める
    const before = snapshot(db, ids);
    assert.notEqual(before[3].completedAt, null);
    const undo = bulk(db, ids, { assignee: "tanaka", status: "in_progress" });
    assert.equal(undo.count, 4);
    assert.deepEqual(
      snapshot(db, ids).map((t) => [t.assignee, t.status]),
      ids.map(() => ["tanaka", "in_progress"]),
    );

    const r = undoBulkUpdate(undo.id, "sato", db, at(60_000));
    assert.deepEqual(r, { ok: true, restoredIds: [1, 2, 4, 5], skippedIds: [] });
    assert.deepEqual(snapshot(db, ids), before);
  });

  it("値が変わらなかったタスクは記録せず、元に戻しても触らない。1 件も変わらなければ元に戻すは出ない", () => {
    const db = openDb();
    const undo = bulk(db, [1, 2, 3], { assignee: "sato" }); // 1・3 はもう sato
    assert.equal(undo.count, 1);
    const before1 = getTask(1, db)!.updatedAt;
    const r = undoBulkUpdate(undo.id, "sato", db, at(1000));
    assert.deepEqual(r, { ok: true, restoredIds: [2], skippedIds: [] });
    assert.equal(getTask(1, db)!.updatedAt, before1);
    assert.equal(getTask(2, db)!.assignee, "suzuki");

    const none = updateTasks([1, 3], { assignee: "sato" }, db, "sato", T0);
    assert.ok(none.ok);
    assert.equal(none.undo, null);
  });

  it("担当者を戻すと、担当者の変更の履歴に、戻した人の名前で 1 件ずつ残る。ステータスだけなら履歴は足さない", () => {
    const db = openDb();
    const undo = bulk(db, [2, 4], { assignee: "sato" }, "sato");
    undoBulkUpdate(undo.id, "sato", db, at(1000));
    for (const [id, from] of [[2, "suzuki"], [4, "tanaka"]] as const) {
      const [latest, first] = listAssigneeChanges(id, db);
      assert.deepEqual([first.fromAssignee, first.toAssignee], [from, "sato"]);
      assert.deepEqual([latest.fromAssignee, latest.toAssignee, latest.changedBy], ["sato", from, "sato"]);
      assert.equal(latest.changedAt, getTask(id, db)!.updatedAt);
    }

    const statusOnly = bulk(db, [6], { status: "done" });
    undoBulkUpdate(statusOnly.id, "sato", db, at(2000));
    assert.deepEqual(listAssigneeChanges(6, db), []);
    assert.equal(getTask(6, db)!.status, "todo");
  });

  it("戻したタスクの更新日時は、前回の更新日時より必ず後になる（同じミリ秒でも）", () => {
    const db = openDb();
    const undo = bulk(db, [2], { assignee: "sato" });
    const changed = getTask(2, db)!.updatedAt;
    undoBulkUpdate(undo.id, "sato", db, T0); // まとめて変えたのと同じ時刻
    assert.ok(getTask(2, db)!.updatedAt > changed);
  });

  it("変えてからちょうど 10 分は戻せ、1 ミリ秒でも過ぎると断る（何も変えない）", () => {
    const db = openDb();
    const a = bulk(db, [2], { assignee: "sato" });
    assert.equal(undoBulkUpdate(a.id, "sato", db, at(BULK_UNDO_WINDOW_MS)).ok, true);

    const b = bulk(db, [4], { assignee: "sato" });
    assert.deepEqual(undoBulkUpdate(b.id, "sato", db, at(BULK_UNDO_WINDOW_MS + 1)), { ok: false, reason: "expired" });
    assert.equal(getTask(4, db)!.assignee, "sato");
    // 期限切れで断ったあとも、記録は戻していないまま（戻した印を付けない）
    assert.equal(bulkUndoRefusal({ changedBy: "sato", changedAt: T0.toISOString(), undoneAt: null }, "sato", at(BULK_UNDO_WINDOW_MS + 1)), "expired");
  });

  it("変えた本人のほかは戻せない。変えた人が分からない記録はだれも戻せない", () => {
    const db = openDb();
    const undo = bulk(db, [2], { assignee: "sato" }, "sato");
    assert.deepEqual(undoBulkUpdate(undo.id, "tanaka", db, at(1000)), { ok: false, reason: "forbidden" });
    assert.equal(getTask(2, db)!.assignee, "sato");
    // 断ったあとも、本人は戻せる
    assert.equal(undoBulkUpdate(undo.id, "sato", db, at(2000)).ok, true);

    const r = updateTasks([4], { assignee: "sato" }, db, null, T0);
    assert.ok(r.ok && r.undo);
    assert.deepEqual(undoBulkUpdate(r.undo.id, "sato", db, at(1000)), { ok: false, reason: "forbidden" });
  });

  it("変えた後にほかの人が変えたタスク・削除したタスクは戻さず、ほかのタスクは戻る", () => {
    const db = openDb();
    const undo = bulk(db, [2, 4, 5, 7], { assignee: "sato" }, "sato");
    updateTask(4, { status: "in_progress" }, db, "tanaka"); // ほかの人の変更
    const t5 = getTask(5, db)!;
    assert.equal(updateTaskIfUnchanged(5, { assignee: "tanaka" }, t5.updatedAt, db, "tanaka").ok, true);
    deleteTask(7, "sato", db);

    const r = undoBulkUpdate(undo.id, "sato", db, at(1000));
    assert.deepEqual(r, { ok: true, restoredIds: [2], skippedIds: [4, 5, 7] });
    assert.equal(getTask(2, db)!.assignee, "suzuki");
    assert.deepEqual([getTask(4, db)!.assignee, getTask(4, db)!.status], ["sato", "in_progress"], "ほかの人の変更を上書きしない");
    assert.equal(getTask(5, db)!.assignee, "tanaka");
  });

  it("元に戻すのは 1 回だけ。2 回目は断り、何も変えない", () => {
    const db = openDb();
    const undo = bulk(db, [2], { assignee: "sato" });
    assert.equal(undoBulkUpdate(undo.id, "sato", db, at(1000)).ok, true);
    updateTask(2, { assignee: "tanaka" }, db, "sato");
    const before = getTask(2, db)!;
    assert.deepEqual(undoBulkUpdate(undo.id, "sato", db, at(2000)), { ok: false, reason: "already_undone" });
    assert.deepEqual(getTask(2, db), before);
  });

  it("記録が無い ID は見つからない", () => {
    const db = openDb();
    assert.deepEqual(undoBulkUpdate(999, "sato", db, T0), { ok: false, reason: "not_found" });
  });

  it("途中で失敗したら、どのタスクも戻さず、戻した印も付けない", () => {
    const db = openDb();
    const undo = bulk(db, [2, 4], { assignee: "sato" });
    // 担当者の履歴の書き込みを失敗させる
    db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON task_assignee_changes WHEN NEW.task_id = 4 BEGIN SELECT RAISE(ABORT, 'boom'); END");
    assert.throws(() => undoBulkUpdate(undo.id, "sato", db, at(1000)));
    assert.equal(getTask(2, db)!.assignee, "sato");
    db.exec("DROP TRIGGER fail_history");
    assert.deepEqual(undoBulkUpdate(undo.id, "sato", db, at(2000)), { ok: true, restoredIds: [2, 4], skippedIds: [] });
  });
});

describe("元に戻す API の本文の検証", () => {
  it("id は正の整数だけ", () => {
    assert.deepEqual(validateBulkUndoInput({ id: 3 }), { ok: true, value: { id: 3 } });
    for (const body of [null, [], "3", {}, { id: "3" }, { id: 0 }, { id: -1 }, { id: 1.5 }]) {
      assert.equal(validateBulkUndoInput(body).ok, false, JSON.stringify(body));
    }
  });
});

describe("元に戻す（画面の処理）", () => {
  const USERS = [
    { id: "sato", name: "佐藤" },
    { id: "suzuki", name: "鈴木" },
  ];

  /** まとめて変える API・元に戻す API と同じ処理に通す偽の通信（ログイン中は sato）。 */
  function apiOn(db: Db, user = "sato") {
    return async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (url === "/api/tasks/bulk-update") {
        const input = validateBulkUpdateInput(body, db);
        assert.ok(input.ok);
        const r = updateTasks(input.value.ids, input.value.changes, db, user);
        assert.ok(r.ok);
        return { ok: true, status: 200, json: async () => ({ tasks: r.tasks, undo: r.undo }) };
      }
      const input = validateBulkUndoInput(body);
      assert.ok(input.ok);
      const r = undoBulkUpdate(input.value.id, user, db);
      if (!r.ok) return { ok: false, status: 409, json: async () => ({ error: `断った: ${r.reason}` }) };
      return { ok: true, status: 200, json: async () => ({ restoredIds: r.restoredIds, skippedIds: r.skippedIds }) };
    };
  }

  it("変えた直後に件数と項目の文言と元に戻すを出し、押すと戻って件数を出す", async () => {
    const db = openDb();
    const r = await confirmAndBulkUpdate([1, 2, 3], { assignee: "suzuki", status: "" }, USERS, { confirm: () => true, fetch: apiOn(db) });
    assert.equal(r.status, "updated");
    assert.ok(r.status === "updated" && r.undo);
    assert.equal(r.message, "2 件の担当者を変えました。"); // 2 はもう suzuki
    const u = await requestBulkUndo(r.undo.id, { fetch: apiOn(db) });
    assert.deepEqual(u, { status: "undone", message: "2 件を元に戻しました。" });
    assert.deepEqual([1, 2, 3].map((id) => getTask(id, db)!.assignee), ["sato", "suzuki", "sato"]);

    const again = await requestBulkUndo(r.undo.id, { fetch: apiOn(db) });
    assert.deepEqual(again, { status: "error", message: "断った: already_undone" });
  });

  it("文言: 変えた項目と、戻せなかった件数と理由", () => {
    assert.equal(bulkUndoOfferMessage(3, { status: "done" }), "3 件のステータスを変えました。");
    assert.equal(bulkUndoOfferMessage(1, { assignee: "sato", status: "done" }), "1 件の担当者とステータスを変えました。");
    assert.equal(bulkUndoDoneMessage(2, 1), "2 件を元に戻しました。1 件は、変えた後にほかの変更があった（または削除された）ため、戻していません。");
    assert.equal(bulkUndoDoneMessage(0, 2), "0 件を元に戻しました。2 件は、変えた後にほかの変更があった（または削除された）ため、戻していません。");
  });

  it("応答に元に戻す記録が無い・0 件なら、元に戻すを出さない", () => {
    assert.equal(parseUndoOffer({ tasks: [] }), undefined);
    assert.equal(parseUndoOffer({ undo: null }), undefined);
    assert.equal(parseUndoOffer({ undo: { id: 1, count: 0 } }), undefined);
    assert.equal(parseUndoOffer({ undo: { id: "1", count: 1 } }), undefined);
    assert.deepEqual(parseUndoOffer({ undo: { id: 1, count: 2 } }), { id: 1, count: 2 });
  });

  it("通信に失敗したら決まった文言を出す", async () => {
    const r = await requestBulkUndo(1, { fetch: async () => { throw new Error("offline"); } });
    assert.deepEqual(r, { status: "error", message: "元に戻せませんでした。" });
  });
});
