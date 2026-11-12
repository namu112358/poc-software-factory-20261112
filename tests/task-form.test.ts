import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { listUserOptions } from "../src/lib/users.ts";
import { validateTaskInput } from "../src/lib/task-validation.ts";
import { TASK_CREATE_FAILED_MESSAGE, buildTaskBody, taskDetailHref, taskFormErrorMessages } from "../src/lib/task-form.ts";

describe("タスク作成画面の入力", () => {
  it("入力した値をそのまま API の本文にし、既存の検証を通る", () => {
    const db = openDb();
    const body = buildTaskBody({ title: "資料を作る", assignee: "sato", dueDate: "2026-12-01", status: "todo" });
    const r = validateTaskInput(body, {}, db);
    assert.equal(r.ok, true);
  });
  it("担当者の選択肢は、タスクを持たない利用者も含めた利用者全員になる", () => {
    const db = openDb();
    db.prepare("UPDATE tasks SET assignee = 'sato'").run();
    const ids = listUserOptions(db).map((u) => u.id);
    assert.deepEqual(ids, ["sato", "suzuki", "tanaka"]);
    const r = validateTaskInput(buildTaskBody({ title: "x", assignee: "tanaka", dueDate: "2026-12-01", status: "todo" }), {}, db);
    assert.equal(r.ok, true);
  });
  it("タイトルが空・期限が日付でないと、検証で日本語の理由が返る", () => {
    const db = openDb();
    const r = validateTaskInput(buildTaskBody({ title: "", assignee: "sato", dueDate: "あした", status: "todo" }), {}, db);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errors.length, 2);
  });
  it("API の details を理由として並べ、読めない応答は既定の文言にする", () => {
    assert.deepEqual(taskFormErrorMessages({ error: "入力内容に誤りがあります", details: ["a", "b"] }), ["a", "b"]);
    assert.deepEqual(taskFormErrorMessages({ error: "x" }), ["x"]);
    assert.deepEqual(taskFormErrorMessages(undefined), [TASK_CREATE_FAILED_MESSAGE]);
  });
  it("作成したタスクの詳細画面へ移る", () => {
    assert.equal(taskDetailHref(7), "/tasks/7");
  });
});
