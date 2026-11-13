import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import {
  TASK_EDIT_FIELD_LABELS,
  canSaveTaskEdit,
  changedFields,
  conflictRows,
  mergeEditValues,
  rebaseOnCurrent,
  recordConflict,
  saveTaskEdit,
  startTaskEdit,
  taskToEditValues,
  type TaskEditState,
  type TaskEditValues,
} from "../src/lib/task-edit.ts";
import { undoBulkUpdate } from "../src/lib/bulk-undo.ts";
import { updateTasks } from "../src/lib/bulk-update.ts";
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

  it("「今の値で編集し直す」で、相手が変えた項目は今の値・自分だけが変えた項目は自分の入力になり、その後の保存は今の更新日時で確かめて保存される", async () => {
    const db = openDb();
    const opened = startTaskEdit(getTask(3, db)!);
    updateTask(3, { memo: "ほかの人のメモ" }, db);
    const conflicted = await saveAndRecord({ ...opened, values: { ...opened.values, title: "自分の変更" } }, db);
    const latest = getTask(3, db)!;
    const rebased = rebaseOnCurrent(conflicted);
    assert.deepEqual(rebased.values, { ...taskToEditValues(latest), title: "自分の変更" });
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

// 編集し直したとき、相手が変えていない項目の自分の入力を残す（#446）。

describe("mergeEditValues（編集し直したときの項目ごとの値の決め方）", () => {
  const base: TaskEditValues = { title: "元", status: "todo", assignee: "sato", dueDate: "2026-11-14", priority: "medium", memo: "" };

  it("相手がメモだけ、自分が期限だけを変えたら、メモは今の値・期限は自分の入力になる", () => {
    const current = { ...base, memo: "相手のメモ" };
    const mine = { ...base, dueDate: "2026-11-27" };
    assert.deepEqual(mergeEditValues(base, current, mine), { ...base, memo: "相手のメモ", dueDate: "2026-11-27" });
  });

  it("相手と自分が同じ項目を変えていたら、その項目は今の値（相手の値）になる", () => {
    const current = { ...base, dueDate: "2026-12-01" };
    const mine = { ...base, dueDate: "2026-11-27", title: "自分のタイトル" };
    assert.deepEqual(mergeEditValues(base, current, mine), { ...base, dueDate: "2026-12-01", title: "自分のタイトル" });
  });

  it("相手が変えた値と自分の入力が同じでも、今の値になる", () => {
    const current = { ...base, priority: "high" as const };
    assert.deepEqual(mergeEditValues(base, current, { ...current }), current);
  });

  it("6 項目すべてで、相手が変えた項目は今の値、変えていない項目は自分の入力にする", () => {
    const current: TaskEditValues = { title: "相手", status: "done", assignee: "tanaka", dueDate: "", priority: "high", memo: "相手のメモ" };
    const mine: TaskEditValues = { title: "自分", status: "in_progress", assignee: "suzuki", dueDate: "2030-02-02", priority: "low", memo: "自分のメモ" };
    assert.deepEqual(mergeEditValues(base, current, mine), current);
    assert.deepEqual(mergeEditValues(base, { ...base }, mine), mine);
    for (const field of Object.keys(TASK_EDIT_FIELD_LABELS) as (keyof TaskEditValues)[]) {
      const one = { ...base, [field]: current[field] } as TaskEditValues;
      assert.deepEqual(mergeEditValues(base, one, mine), { ...mine, [field]: current[field] }, field);
    }
  });

  it("相手が変えて元に戻した項目（始めの値と今の値が同じ）は、自分の入力を残す", () => {
    const mine = { ...base, title: "自分のタイトル" };
    assert.deepEqual(mergeEditValues(base, { ...base }, mine), mine);
  });

  it("渡した値は書き換えない", () => {
    const current = { ...base, memo: "相手のメモ" };
    const mine = { ...base, dueDate: "2026-11-27" };
    const copies = [{ ...base }, { ...current }, { ...mine }];
    mergeEditValues(base, current, mine);
    assert.deepEqual([base, current, mine], copies);
  });
});

describe("編集し直してから保存する（#446）", () => {
  it("相手がメモ、自分が期限を変えて衝突したら、編集し直してそのまま保存すると両方の変更が残る", async () => {
    const db = openDb();
    const opened = startTaskEdit(getTask(3, db)!);
    updateTask(3, { memo: "佐藤のメモ" }, db);
    const conflicted = await saveAndRecord({ ...opened, values: { ...opened.values, dueDate: "2031-11-27" } }, db);
    const rows = conflictRows(conflicted.base, taskToEditValues(conflicted.conflict!), conflicted.values, names);
    assert.deepEqual(rows.map((r) => r.field), ["memo"]);
    const rebased = rebaseOnCurrent(conflicted);
    assert.equal(rebased.values.memo, "佐藤のメモ");
    assert.equal(rebased.values.dueDate, "2031-11-27");
    const result = await saveTaskEdit(3, rebased.values, rebased.expectedUpdatedAt, { fetch: fakeServer(db) });
    assert.equal(result.status, "saved");
    const saved = getTask(3, db)!;
    assert.equal(saved.memo, "佐藤のメモ");
    assert.equal(saved.dueDate, "2031-11-27");
  });

  it("相手がフォームの項目を変えていない衝突では、自分の入力がすべて残り、送る更新日時だけが今のものになる", () => {
    const task = getTask(3, openDb())!;
    const opened = startTaskEdit(task);
    const typed = { ...opened, values: { ...opened.values, title: "自分", memo: "自分のメモ" } };
    const latest = { ...task, updatedAt: "2099-01-01T00:00:00.000Z" };
    const rebased = rebaseOnCurrent(recordConflict(typed, latest));
    assert.deepEqual(rebased.values, typed.values);
    assert.equal(rebased.expectedUpdatedAt, latest.updatedAt);
    assert.deepEqual(rebased.base, taskToEditValues(latest));
  });

  it("編集し直した後にまた別の人が保存していれば、もう一度断られ、2 回目はその人が変えた項目だけが今の値になる", async () => {
    const db = openDb();
    const opened = startTaskEdit(getTask(3, db)!);
    updateTask(3, { memo: "1 回目の相手" }, db);
    const first = rebaseOnCurrent(await saveAndRecord({ ...opened, values: { ...opened.values, title: "自分のタイトル" } }, db));
    updateTask(3, { priority: "low" }, db);
    const before = getTask(3, db)!;
    const typed = { ...first, values: { ...first.values, dueDate: "2031-05-05" } };
    const second = await saveAndRecord(typed, db);
    assert.deepEqual(getTask(3, db), before);
    const rebased = rebaseOnCurrent(second);
    assert.deepEqual(rebased.values, { ...typed.values, priority: "low" });
    assert.equal(rebased.values.memo, "1 回目の相手");
    assert.equal(rebased.expectedUpdatedAt, before.updatedAt);
  });

  it("まとめての変更（ステータス・担当者）で相手が変えた場合も、変えられた項目だけが今の値になる", async () => {
    const db = openDb();
    const task = getTask(3, db)!;
    const opened = startTaskEdit(task);
    const nextAssignee = task.assignee === "tanaka" ? "suzuki" : "tanaka";
    const nextStatus = task.status === "done" ? "todo" : "done";
    const r = updateTasks([3], { status: nextStatus, assignee: nextAssignee }, db, "tanaka");
    assert.ok(r.ok);
    const typed = { ...opened, values: { ...opened.values, title: "自分のタイトル", memo: "自分のメモ", priority: "high" as const } };
    const rebased = rebaseOnCurrent(await saveAndRecord(typed, db));
    assert.deepEqual(rebased.values, { ...typed.values, status: nextStatus, assignee: nextAssignee });
    const result = await saveTaskEdit(3, rebased.values, rebased.expectedUpdatedAt, { fetch: fakeServer(db) });
    assert.equal(result.status, "saved");
    const saved = getTask(3, db)!;
    assert.deepEqual(taskToEditValues(saved), rebased.values);
  });

  it("まとめての変更を元に戻した場合も、戻された項目だけが今の値になる", async () => {
    const db = openDb();
    const now = new Date();
    const original = getTask(3, db)!.status;
    const changedTo = original === "done" ? "todo" : "done";
    const r = updateTasks([3], { status: changedTo }, db, "sato", now);
    assert.ok(r.ok && r.undo);
    const opened = startTaskEdit(getTask(3, db)!);
    const undone = undoBulkUpdate(r.undo.id, "sato", db, new Date(now.getTime() + 1000));
    assert.ok(undone.ok);
    const typed = { ...opened, values: { ...opened.values, dueDate: "2031-03-03" } };
    const rebased = rebaseOnCurrent(await saveAndRecord(typed, db));
    assert.deepEqual(rebased.values, { ...typed.values, status: original });
  });
});
