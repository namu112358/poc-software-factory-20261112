import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { validateTaskInput } from "../src/lib/task-validation.ts";
import { DUE_DATE_EMPTY_MESSAGE, fieldErrorProps, fieldErrorText, toFormErrorItems } from "../src/lib/form-errors.ts";

const base = { title: "x", assignee: "sato", status: "todo" };

describe("フォームの誤りの文と欄の対応", () => {
  it("期限が空のときは「期限を選んでください」にし、期限の欄の誤りにする", () => {
    const r = validateTaskInput({ ...base, dueDate: "" }, {}, openDb());
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.deepEqual(toFormErrorItems(r.errors, { dueDate: "" }), [{ message: DUE_DATE_EMPTY_MESSAGE, field: "dueDate" }]);
  });
  it("期限の形式が誤っているときは、API の文のまま", () => {
    const r = validateTaskInput({ ...base, dueDate: "あした" }, {}, openDb());
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.deepEqual(toFormErrorItems(r.errors, { dueDate: "あした" }), [{ message: r.errors[0], field: "dueDate" }]);
  });
  it("タイトルと期限の両方が誤りなら、それぞれの欄に結び付く", () => {
    const r = validateTaskInput({ ...base, title: "", dueDate: "" }, {}, openDb());
    assert.equal(r.ok, false);
    if (r.ok) return;
    const items = toFormErrorItems(r.errors, { dueDate: "" });
    assert.deepEqual(items.map((i) => i.field), ["title", "dueDate"]);
    assert.deepEqual(fieldErrorProps(items, "f", "title"), { "aria-invalid": true, "aria-describedby": "f-error-title" });
    assert.deepEqual(fieldErrorProps(items, "f", "memo"), {});
    assert.equal(fieldErrorText(items, "dueDate"), DUE_DATE_EMPTY_MESSAGE);
  });
  it("欄に対応しない文は、欄に結び付けず一覧にだけ残す", () => {
    assert.deepEqual(toFormErrorItems(["タスクを作成できませんでした"], { dueDate: "" }), [{ message: "タスクを作成できませんでした" }]);
  });
});
