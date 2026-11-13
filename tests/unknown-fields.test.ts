import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { ABSENCE_INPUT_FIELDS, getAbsence, setAbsence, validateAbsenceInput } from "../src/lib/absence.ts";
import { setTaskArchived } from "../src/lib/archive-toggle.ts";
import { validatePasswordChangeInput } from "../src/lib/auth.ts";
import { unknownFieldErrors } from "../src/lib/body-fields.ts";
import { confirmAndBulkUpdate, requestBulkUndo } from "../src/lib/bulk-select.ts";
import { validateBulkUndoInput } from "../src/lib/bulk-undo.ts";
import { updateTasks, validateBulkUpdateInput } from "../src/lib/bulk-update.ts";
import { validateCommentInput } from "../src/lib/comments.ts";
import { validateExtensionInput } from "../src/lib/extensions.ts";
import { validateTagInput, validateTagRenameInput } from "../src/lib/tags.ts";
import { submitExtensionRequest } from "../src/lib/task-extension-panel.ts";
import { buildTaskBody } from "../src/lib/task-form.ts";
import { buildTaskEditBody, taskToEditValues } from "../src/lib/task-edit.ts";
import {
  completeTasks,
  createTask,
  getTask,
  parseExpectedUpdatedAt,
  TASK_INPUT_FIELDS,
  updateTask,
  validateBulkCompleteInput,
  validateTaskInput,
  type TaskInput,
  type ValidationResult,
} from "../src/lib/tasks.ts";

// 書き込みの API に、受け付ける項目のほかの項目（タイプミスを含む）を送ったら、黙って無視せずに 400 で知らせる（#527）。
// ルートは next/server を読み込むため単体テストから呼べない。ルートと同じ順（検証 → 誤りなら 400 で何もしない → 書き込む）で、
// src/lib の関数を呼んで確かめる。

const SERVER_FIELDS = ["id", "createdAt", "updatedAt", "completedAt"] as const;
const VALID_CREATE = { title: "t", status: "todo", assignee: "sato", dueDate: "2026-12-01" };

function taskCount(db: Db): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n);
}

function errorsOf<T>(r: ValidationResult<T>): string[] {
  assert.equal(r.ok, false, "誤りになるはず");
  return r.ok ? [] : r.errors;
}

/** 誤りの文言のどれかに、項目の名前が入っているか。 */
function mentions(errors: string[], field: string): boolean {
  return errors.some((e) => e.startsWith(`${field} `));
}

/** POST /api/tasks と同じ順。 */
function postTask(db: Db, body: unknown): { status: 201 | 400; details?: string[] } {
  const r = validateTaskInput(body, {}, db);
  if (!r.ok) return { status: 400, details: r.errors };
  createTask(r.value as TaskInput, db);
  return { status: 201 };
}

/** PATCH /api/tasks/:id と同じ順（確認つきの更新は、ここでは確認なしの更新で代える）。 */
function patchTask(db: Db, id: number, body: unknown): { status: 200 | 400; details?: string[] } {
  const current = getTask(id, db)!;
  const r = validateTaskInput(body, { partial: true, currentAssignee: current.assignee }, db);
  const expected = parseExpectedUpdatedAt(body);
  if (!r.ok || !expected.ok) return { status: 400, details: [...(r.ok ? [] : r.errors), ...(expected.ok ? [] : expected.errors)] };
  updateTask(id, r.value, db, "sato");
  return { status: 200 };
}

/** 画面の処理が fetch に渡す本文を取り出す。 */
function captureFetch(response: unknown = {}) {
  const bodies: unknown[] = [];
  const fetch = async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => response };
  };
  return { bodies, fetch };
}

describe("POST /api/tasks（作成）", () => {
  it("dueDat のようなタイプミスの項目があれば 400 で、details にその名前が入り、タスクは作られない", () => {
    const db = openDb();
    const before = taskCount(db);
    const res = postTask(db, JSON.parse('{"title":"t","status":"todo","assignee":"sato","dueDate":"2026-12-01","dueDat":"x"}'));
    assert.equal(res.status, 400);
    assert.ok(mentions(res.details!, "dueDat"), String(res.details));
    assert.equal(taskCount(db), before);
  });

  it("知らない項目が複数あれば、すべての名前を並べる", () => {
    const res = postTask(openDb(), { ...VALID_CREATE, foo: 1, tags: ["a"] });
    assert.equal(res.status, 400);
    assert.ok(mentions(res.details!, "foo") && mentions(res.details!, "tags"));
  });

  for (const field of SERVER_FIELDS) {
    it(`サーバーが付ける項目 ${field} を入れると 400 で、タスクは作られない`, () => {
      const db = openDb();
      const before = taskCount(db);
      const res = postTask(db, { ...VALID_CREATE, [field]: field === "id" ? 999 : "2026-01-01T00:00:00.000Z" });
      assert.equal(res.status, 400);
      assert.deepEqual(res.details, [`${field} はサーバーが付ける項目のため、送れません`]);
      assert.equal(taskCount(db), before);
    });
  }

  it("値が null の知らない項目も 400", () => {
    assert.equal(postTask(openDb(), { ...VALID_CREATE, foo: null }).status, 400);
  });

  it("__proto__ という名前の項目も、知らない項目として 400", () => {
    const res = postTask(openDb(), JSON.parse('{"title":"t","status":"todo","assignee":"sato","dueDate":"2026-12-01","__proto__":{"x":1}}'));
    assert.equal(res.status, 400);
    assert.ok(mentions(res.details!, "__proto__"));
  });

  it("expectedUpdatedAt は更新だけで使う項目なので、作成では 400", () => {
    const res = postTask(openDb(), { ...VALID_CREATE, expectedUpdatedAt: "2026-11-12T09:00:00.000Z" });
    assert.equal(res.status, 400);
    assert.ok(mentions(res.details!, "expectedUpdatedAt"));
  });

  it("知らない項目とほかの入力の誤りが同時にあれば、両方を並べる", () => {
    const res = postTask(openDb(), { ...VALID_CREATE, title: "", dueDat: "x" });
    assert.equal(res.status, 400);
    assert.ok(mentions(res.details!, "dueDat"));
    assert.ok(res.details!.includes("タイトルは 1〜200 文字で入力してください"));
  });

  it("今 受け付けている項目をすべて送った本文は、今までどおり作れる", () => {
    const db = openDb();
    const body = { ...VALID_CREATE, priority: "high", estimateMinutes: 30, memo: "m", archived: false };
    assert.deepEqual(Object.keys(body).sort(), [...TASK_INPUT_FIELDS].sort());
    assert.equal(postTask(db, body).status, 201);
  });

  it("作成の画面が送る本文は、今までどおり作れる", () => {
    const body = buildTaskBody({ title: "t", assignee: "sato", dueDate: "2026-12-01", status: "todo", priority: "medium", memo: "" });
    assert.equal(postTask(openDb(), body).status, 201);
  });
});

describe("PATCH /api/tasks/:id（更新）", () => {
  it("知らない項目があれば 400 で、ほかの正しい項目も含めて何も変えない", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    const res = patchTask(db, 1, { title: "新しい題名", dueDat: "2026-12-31" });
    assert.equal(res.status, 400);
    assert.ok(mentions(res.details!, "dueDat"));
    assert.deepEqual(getTask(1, db), before);
  });

  for (const field of SERVER_FIELDS) {
    it(`サーバーが付ける項目 ${field} を入れると 400 で、何も変えない`, () => {
      const db = openDb();
      const before = getTask(1, db)!;
      const res = patchTask(db, 1, { memo: "x", [field]: field === "id" ? 2 : "2000-01-01T00:00:00.000Z" });
      assert.equal(res.status, 400);
      assert.deepEqual(res.details, [`${field} はサーバーが付ける項目のため、送れません`]);
      assert.deepEqual(getTask(1, db), before);
    });
  }

  it("知らない項目と expectedUpdatedAt の誤りが同時にあれば、両方を並べる", () => {
    const res = patchTask(openDb(), 1, { foo: 1, expectedUpdatedAt: "きのう" });
    assert.equal(res.status, 400);
    assert.ok(mentions(res.details!, "foo") && mentions(res.details!, "expectedUpdatedAt"));
  });

  it("expectedUpdatedAt を含む、今 受け付けている項目だけの本文は、今までどおり更新できる", () => {
    const db = openDb();
    const task = getTask(1, db)!;
    const body = { title: "改", status: "in_progress", assignee: "sato", dueDate: "2026-12-01", priority: "low", estimateMinutes: null, memo: "m", archived: false, expectedUpdatedAt: task.updatedAt };
    assert.equal(patchTask(db, 1, body).status, 200);
    assert.equal(getTask(1, db)!.title, "改");
  });

  it("項目の無い {} は、今までどおり 200", () => {
    assert.equal(patchTask(openDb(), 1, {}).status, 200);
  });

  it("編集の画面が送る本文（expectedUpdatedAt 付き）は、今までどおり更新できる", () => {
    const db = openDb();
    const task = getTask(1, db)!;
    const body = buildTaskEditBody({ ...taskToEditValues(task), title: "編集した題名" }, task.updatedAt);
    assert.equal(patchTask(db, 1, body).status, 200);
    assert.equal(getTask(1, db)!.title, "編集した題名");
  });

  it("アーカイブのボタンが送る本文（archived・expectedUpdatedAt）は、今までどおり更新できる", async () => {
    const db = openDb();
    const { bodies, fetch } = captureFetch();
    await setTaskArchived(1, true, getTask(1, db)!.updatedAt, { fetch });
    assert.equal(patchTask(db, 1, bodies[0]).status, 200);
    assert.equal(getTask(1, db)!.archived, true);
  });
});

describe("まとめての変更・まとめて完了・取り消し", () => {
  it("bulk-update の本文に知らない項目があれば 400 で、どのタスクも変えない", () => {
    const db = openDb();
    const before = [getTask(1, db), getTask(2, db)];
    const r = validateBulkUpdateInput({ ids: [1, 2], changes: { status: "done" }, dryRun: true }, db);
    assert.ok(mentions(errorsOf(r), "dryRun"));
    assert.deepEqual([getTask(1, db), getTask(2, db)], before);
  });

  it("bulk-update の changes に知らない項目があれば 400 で、その名前が入る", () => {
    const r = validateBulkUpdateInput({ ids: [1], changes: { status: "done", dueDate: "2026-12-01" } }, openDb());
    assert.ok(errorsOf(r).some((e) => e.includes("dueDate")));
  });

  it("bulk-update の本文の知らない項目と ids の誤りを、両方並べる", () => {
    const errors = errorsOf(validateBulkUpdateInput({ ids: [], changes: { status: "done" }, foo: 1 }, openDb()));
    assert.ok(mentions(errors, "foo"));
    assert.ok(errors.includes("ids に 1 件以上の ID を指定してください"));
  });

  it("まとめての変更の画面が送る本文は、今までどおり受け付ける", async () => {
    const db = openDb();
    const { bodies, fetch } = captureFetch({ tasks: [], undo: null });
    await confirmAndBulkUpdate([1, 2], { status: "done", assignee: "" }, [], { fetch, confirm: () => true });
    const r = validateBulkUpdateInput(bodies[0], db);
    assert.ok(r.ok, String(!r.ok && r.errors));
    assert.ok(updateTasks(r.value.ids, r.value.changes, db).ok);
  });

  it("bulk-complete に知らない項目があれば 400 で、どのタスクも完了にしない", () => {
    const db = openDb();
    const before = getTask(1, db);
    assert.ok(mentions(errorsOf(validateBulkCompleteInput({ ids: [1], completedAt: "2026-01-01T00:00:00.000Z" })), "completedAt"));
    assert.deepEqual(getTask(1, db), before);
  });

  it("bulk-complete の知らない項目と ids の誤りを、両方並べる", () => {
    const errors = errorsOf(validateBulkCompleteInput({ foo: 1 }));
    assert.ok(mentions(errors, "foo"));
    assert.ok(errors.includes("ids を指定してください"));
  });

  it("bulk-complete の ids だけの本文は、今までどおり受け付ける", () => {
    const db = openDb();
    const r = validateBulkCompleteInput({ ids: [1, 1, 2] });
    assert.deepEqual(r, { ok: true, value: [1, 2] });
    assert.ok(completeTasks(r.ok ? r.value : [], db).ok);
  });

  it("取り消し（bulk-update/undo）に知らない項目があれば 400、画面の本文（id だけ）は受け付ける", async () => {
    assert.ok(mentions(errorsOf(validateBulkUndoInput({ id: 1, force: true })), "force"));
    const { bodies, fetch } = captureFetch({ restoredIds: [], skippedIds: [] });
    await requestBulkUndo(5, { fetch });
    assert.deepEqual(validateBulkUndoInput(bodies[0]), { ok: true, value: { id: 5 } });
  });
});

describe("コメント・タグ・延長の申請・休み・パスワード", () => {
  it("コメント（投稿・編集）: 知らない項目があれば誤り、画面の本文（body だけ）は受け付ける", () => {
    assert.ok(mentions(errorsOf(validateCommentInput({ body: "こんにちは", author: "suzuki" })), "author"));
    assert.deepEqual(validateCommentInput({ body: " こんにちは " }), { ok: true, value: { body: "こんにちは" } });
  });

  it("コメント: 知らない項目と本文の誤りを、両方並べる", () => {
    const errors = errorsOf(validateCommentInput({ text: "こんにちは" }));
    assert.ok(mentions(errors, "text"));
    assert.ok(errors.includes("本文を文字列で入力してください"));
  });

  it("タグを付ける: 知らない項目があれば誤り、画面の本文（name だけ）は受け付ける", () => {
    assert.ok(mentions(errorsOf(validateTagInput({ name: "急ぎ", color: "red" })), "color"));
    assert.deepEqual(validateTagInput({ name: "急ぎ" }), { ok: true, value: { name: "急ぎ" } });
  });

  it("タグの名前の付け替え: 知らない項目があれば誤り、from・to だけなら受け付ける", () => {
    assert.ok(mentions(errorsOf(validateTagRenameInput({ from: "a", to: "b", form: "a" })), "form"));
    assert.deepEqual(validateTagRenameInput({ from: "a", to: "b" }), { ok: true, value: { from: "a", to: "b" } });
  });

  it("延長の申請: 知らない項目があれば誤り、画面が送る本文は受け付ける", async () => {
    assert.ok(mentions(errorsOf(validateExtensionInput({ newDueDate: "2026-12-31", reason: "r", status: "approved" }, "2026-12-01")), "status"));
    const { bodies, fetch } = captureFetch();
    await submitExtensionRequest(1, { newDueDate: "2026-12-31", reason: " 遅れています " }, "2026-12-01", { fetch });
    assert.deepEqual(validateExtensionInput(bodies[0], "2026-12-01"), { ok: true, value: { newDueDate: "2026-12-31", reason: "遅れています" } });
  });

  it("休み: 知らない項目があれば誤りで登録しない。画面の本文と、本人の userId を添えた本文は受け付ける", () => {
    const db = openDb();
    const errors = errorsOf(validateAbsenceInput({ startDate: "2026-12-01", endDat: "2026-12-03" }));
    assert.ok(mentions(errors, "endDat"));
    assert.ok(errors.includes("終了日を入力してください"));
    assert.equal(getAbsence("sato", db), null);
    assert.deepEqual([...ABSENCE_INPUT_FIELDS].sort(), ["endDate", "startDate", "userId"]);
    const ok = validateAbsenceInput({ startDate: "2026-12-01", endDate: "2026-12-03" });
    assert.ok(ok.ok);
    setAbsence("sato", ok.value, db);
    assert.deepEqual(getAbsence("sato", db), { startDate: "2026-12-01", endDate: "2026-12-03" });
    assert.ok(validateAbsenceInput({ startDate: "2026-12-01", endDate: "2026-12-03", userId: "sato" }).ok);
  });

  it("パスワード: 確認用の項目など、知らない項目があれば誤り。画面の本文は受け付ける", () => {
    const errors = errorsOf(validatePasswordChangeInput({ currentPassword: "password", newPassword: "new-password-1", newPasswordConfirm: "new-password-1" }));
    assert.ok(mentions(errors, "newPasswordConfirm"));
    assert.ok(validatePasswordChangeInput({ currentPassword: "password", newPassword: "new-password-1" }).ok);
  });
});

describe("知らない項目を探す共通の関数", () => {
  it("受け付ける項目だけなら空、それ以外は項目ごとに 1 つ、送られた順で返す", () => {
    assert.deepEqual(unknownFieldErrors({ a: 1 }, ["a", "b"]), []);
    assert.deepEqual(unknownFieldErrors({}, ["a"]), []);
    assert.deepEqual(unknownFieldErrors({ z: 1, a: 1, id: 1 }, ["a"]), [
      "z は受け付けない項目です（受け付ける項目: a）",
      "id はサーバーが付ける項目のため、送れません",
    ]);
  });
});
