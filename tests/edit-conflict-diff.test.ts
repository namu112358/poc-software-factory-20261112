import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import {
  TASK_EDIT_FIELD_LABELS,
  canSaveTaskEdit,
  changedFields,
  conflictRows,
  rebaseOnCurrent,
  recordConflict,
  saveTaskEdit,
  startTaskEdit,
  taskToEditValues,
  type TaskEditState,
  type TaskEditValues,
} from "../src/lib/task-edit.ts";
import { getTask, parseExpectedUpdatedAt, updateTask, updateTaskIfUnchanged, validateTaskInput } from "../src/lib/tasks.ts";

// 同時に編集して保存が衝突したとき（#385）: 入力を残し、相手が変えた項目だけを 3 列で並べ、
// 「今の値で編集し直す」までは保存させない。

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** PATCH /api/tasks/:id と同じ順で検証・更新する偽の通信。 */
function fakeServer(db: Db) {
  return async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as unknown;
    const id = Number(url.split("/").pop());
    const result = validateTaskInput(body, { partial: true }, db);
    const expected = parseExpectedUpdatedAt(body);
    if (!result.ok || !expected.ok) return response(400, { error: "入力内容に誤りがあります" });
    const updated = updateTaskIfUnchanged(id, result.value, expected.value!, db);
    if (updated.ok) return response(200, { task: updated.task });
    if (updated.reason === "not_found") return response(404, { error: "タスクが見つかりません" });
    return response(409, { error: "ほかの人が先にこのタスクを更新しました", task: updated.task });
  };
}

const names = new Map([
  ["sato", "佐藤"],
  ["tanaka", "田中"],
]);

/** 画面と同じ順で、保存して衝突を受け取る。 */
async function saveAndRecord(state: TaskEditState, db: Db): Promise<TaskEditState> {
  const result = await saveTaskEdit(state.taskId, state.values, state.expectedUpdatedAt, { fetch: fakeServer(db) });
  assert.equal(result.status, "conflict");
  return result.status === "conflict" ? recordConflict(state, result.task) : state;
}

describe("changedFields（相手が変えた項目の求め方）", () => {
  const base: TaskEditValues = { title: "元", status: "todo", assignee: "sato", dueDate: "2030-01-01", priority: "medium", memo: "" };

  it("編集を始めたときの値と今の値が違う項目だけを、フォームの並び順で返す", () => {
    const current = { ...base, memo: "相手のメモ", title: "相手のタイトル" };
    assert.deepEqual(changedFields(base, current), ["title", "memo"]);
  });

  it("相手が何も変えていなければ空", () => {
    assert.deepEqual(changedFields(base, { ...base }), []);
  });

  it("6 項目すべてを比べる（どの項目の変更も取りこぼさない）", () => {
    const current: TaskEditValues = { title: "x", status: "done", assignee: "tanaka", dueDate: "", priority: "high", memo: "m" };
    assert.deepEqual(changedFields(base, current), Object.keys(TASK_EDIT_FIELD_LABELS));
  });

  it("自分の入力が相手と同じ値でも、相手が変えた項目として出す（自分の入力では決めない）", () => {
    const current = { ...base, title: "同じ値" };
    const mine = { ...base, title: "同じ値" };
    const rows = conflictRows(base, current, mine, names);
    assert.deepEqual(rows.map((r) => r.field), ["title"]);
  });

  it("自分だけが変えた項目は出さない", () => {
    const mine = { ...base, memo: "自分のメモ" };
    assert.deepEqual(conflictRows(base, { ...base }, mine, names), []);
  });
});

describe("conflictRows（表の 3 列）", () => {
  const base: TaskEditValues = { title: "元", status: "todo", assignee: "sato", dueDate: "2030-01-01", priority: "medium", memo: "1行目\n2行目" };

  it("項目ごとに「編集を始めたときの値」「今の値」「あなたの入力」を、画面で読める形で並べる", () => {
    const current: TaskEditValues = { ...base, status: "done", assignee: "tanaka", dueDate: "", priority: "high" };
    const mine: TaskEditValues = { ...base, status: "in_progress", assignee: "ghost", dueDate: "2030-02-02", priority: "low" };
    assert.deepEqual(conflictRows(base, current, mine, names), [
      { field: "status", label: "ステータス", base: "未着手", current: "完了", mine: "進行中" },
      { field: "assignee", label: "担当者", base: "佐藤", current: "田中", mine: "ghost" },
      { field: "dueDate", label: "期限", base: "2030-01-01", current: "なし", mine: "2030-02-02" },
      { field: "priority", label: "優先度", base: "中", current: "高", mine: "低" },
    ]);
  });

  it("メモの改行はそのまま残す", () => {
    const rows = conflictRows(base, { ...base, memo: "相手\nのメモ" }, base, names);
    assert.deepEqual(rows, [{ field: "memo", label: "メモ", base: "1行目\n2行目", current: "相手\nのメモ", mine: "1行目\n2行目" }]);
  });
});

describe("保存が衝突したときの編集の状態", () => {
  it("衝突すると、フォームの入力・編集を始めたときの値は消えずに残り、相手が変えた項目だけが並ぶ", async () => {
    const db = openDb();
    const opened = startTaskEdit(getTask(3, db)!);
    const typed = { ...opened, values: { ...opened.values, title: "自分のタイトル", memo: "自分のメモ" } };
    updateTask(3, { dueDate: "2031-01-31", priority: "high" }, db); // ほかの人が先に保存する
    const after = await saveAndRecord(typed, db);
    assert.deepEqual(after.values, typed.values);
    assert.deepEqual(after.base, opened.base);
    assert.deepEqual(after.conflict, getTask(3, db));
    const rows = conflictRows(after.base, taskToEditValues(after.conflict!), after.values, names);
    assert.deepEqual(rows.map((r) => r.field), ["dueDate", "priority"]);
    assert.equal(rows[0].current, "2031-01-31");
    assert.equal(rows[0].mine, opened.values.dueDate);
  });

  it("衝突の後は「今の値で編集し直す」まで保存できず、送る更新日時も編集を始めたときのまま", async () => {
    const db = openDb();
    const opened = startTaskEdit(getTask(3, db)!);
    assert.equal(canSaveTaskEdit(opened), true);
    updateTask(3, { memo: "ほかの人のメモ" }, db);
    const after = await saveAndRecord(opened, db);
    assert.equal(canSaveTaskEdit(after), false);
    assert.equal(after.expectedUpdatedAt, opened.expectedUpdatedAt);
  });

  it("「今の値で編集し直す」で、フォームの値が今の値になり、その後の保存は今の更新日時で確かめて保存される", async () => {
    const db = openDb();
    const opened = startTaskEdit(getTask(3, db)!);
    updateTask(3, { memo: "ほかの人のメモ" }, db);
    const conflicted = await saveAndRecord({ ...opened, values: { ...opened.values, title: "自分の変更" } }, db);
    const latest = getTask(3, db)!;
    const rebased = rebaseOnCurrent(conflicted);
    assert.deepEqual(rebased.values, taskToEditValues(latest));
    assert.deepEqual(rebased.base, taskToEditValues(latest));
    assert.equal(rebased.expectedUpdatedAt, latest.updatedAt);
    assert.equal(rebased.conflict, undefined);
    assert.equal(canSaveTaskEdit(rebased), true);
    const values = { ...rebased.values, title: "読み直してから直した" };
    const result = await saveTaskEdit(3, values, rebased.expectedUpdatedAt, { fetch: fakeServer(db) });
    assert.equal(result.status, "saved");
    const saved = getTask(3, db)!;
    assert.equal(saved.title, "読み直してから直した");
    assert.equal(saved.memo, "ほかの人のメモ");
  });

  it("編集し直した後に、またほかの人が保存していれば、もう一度衝突し、どの項目も上書きされない", async () => {
    const db = openDb();
    const opened = startTaskEdit(getTask(3, db)!);
    updateTask(3, { memo: "1 回目" }, db);
    const rebased = rebaseOnCurrent(await saveAndRecord(opened, db));
    updateTask(3, { title: "2 回目の相手の変更" }, db);
    const before = getTask(3, db)!;
    const again = await saveAndRecord({ ...rebased, values: { ...rebased.values, title: "自分", memo: "自分のメモ" } }, db);
    assert.deepEqual(getTask(3, db), before);
    // 2 回目の表は、編集し直したとき（1 回目の後）からの変更だけ
    const rows = conflictRows(again.base, taskToEditValues(again.conflict!), again.values, names);
    assert.deepEqual(rows.map((r) => r.field), ["title"]);
  });

  it("相手がフォームの項目を変えていない（タグなどだけ）なら、表の行は無い", () => {
    const db = openDb();
    const task = getTask(3, db)!;
    const state = recordConflict(startTaskEdit(task), { ...task, updatedAt: "2099-01-01T00:00:00.000Z" });
    assert.equal(canSaveTaskEdit(state), false);
    assert.deepEqual(conflictRows(state.base, taskToEditValues(state.conflict!), state.values, names), []);
  });

  it("別のタスクの応答では、衝突として扱わない", () => {
    const db = openDb();
    const state = startTaskEdit(getTask(3, db)!);
    assert.deepEqual(recordConflict(state, getTask(4, db)!), state);
  });

  it("衝突しなければ、編集し直しは何も変えない", () => {
    const state = startTaskEdit(getTask(3, openDb())!);
    assert.deepEqual(rebaseOnCurrent(state), state);
  });
});
