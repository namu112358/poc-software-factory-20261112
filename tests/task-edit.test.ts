import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import {
  TASK_EDIT_CONFLICT_MESSAGE,
  TASK_EDIT_FAILED_MESSAGE,
  TASK_EDIT_NOT_FOUND_MESSAGE,
  buildTaskEditBody,
  newerTask,
  saveTaskEdit,
  taskToEditValues,
} from "../src/lib/task-edit.ts";
import { deleteTask, getTask, parseExpectedUpdatedAt, updateTask, updateTaskIfUnchanged, validateTaskInput, type Task } from "../src/lib/tasks.ts";

// タスク詳細画面の編集フォームの保存。PATCH /api/tasks/:id と同じ判定をする偽のサーバーで、DB に対して確かめる。

type FakeInit = { method: "PATCH"; headers: Record<string, string>; body: string };

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** PATCH /api/tasks/:id と同じ順で検証・更新する偽の通信。送った回数を数える。 */
function fakeServer(db: Db) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = async (url: string, init: FakeInit) => {
    const body = JSON.parse(init.body) as unknown;
    calls.push({ url, body });
    const id = Number(url.split("/").pop());
    if (!getTask(id, db)) return response(404, { error: "タスクが見つかりません" });
    const result = validateTaskInput(body, { partial: true }, db);
    const expected = parseExpectedUpdatedAt(body);
    if (!result.ok || !expected.ok) {
      const errors = [...(result.ok ? [] : result.errors), ...(expected.ok ? [] : expected.errors)];
      return response(400, { error: "入力内容に誤りがあります", details: errors });
    }
    const updated = updateTaskIfUnchanged(id, result.value, expected.value!, db);
    if (updated.ok) return response(200, { task: updated.task });
    if (updated.reason === "not_found") return response(404, { error: "タスクが見つかりません" });
    return response(409, { error: "ほかの人が先にこのタスクを更新しました", task: updated.task });
  };
  return { fetch, calls };
}

describe("taskToEditValues（フォームを開いたときの値）", () => {
  it("今のタスクのタイトル・ステータス・担当者・期限・優先度・メモが入る", () => {
    const db = openDb();
    const task = getTask(3, db)!;
    assert.deepEqual(taskToEditValues(task), {
      title: task.title,
      status: task.status,
      assignee: task.assignee,
      dueDate: task.dueDate,
      priority: task.priority,
      memo: task.memo,
    });
  });
});

describe("buildTaskEditBody", () => {
  it("フォームを開いたときの更新日時を expectedUpdatedAt として付ける", () => {
    const db = openDb();
    const task = getTask(3, db)!;
    const body = buildTaskEditBody(taskToEditValues(task), task.updatedAt);
    assert.equal(body.expectedUpdatedAt, task.updatedAt);
    assert.equal(body.title, task.title);
  });
});

describe("saveTaskEdit", () => {
  it("値を直して保存すると更新され、新しい値のタスクが返る", async () => {
    const db = openDb();
    const before = getTask(3, db)!;
    const { fetch } = fakeServer(db);
    const values = { ...taskToEditValues(before), title: "直したタイトル", dueDate: "2030-05-01", priority: "high" as const, memo: "メモを書いた" };
    const result = await saveTaskEdit(3, values, before.updatedAt, { fetch });
    assert.equal(result.status, "saved");
    const after = getTask(3, db)!;
    assert.equal(after.title, "直したタイトル");
    assert.equal(after.dueDate, "2030-05-01");
    assert.equal(after.priority, "high");
    assert.equal(after.memo, "メモを書いた");
    assert.ok(result.status === "saved" && result.task.updatedAt === after.updatedAt);
  });

  it("ステータス・担当者も変えられる", async () => {
    const db = openDb();
    const before = getTask(3, db)!;
    const { fetch } = fakeServer(db);
    const values = { ...taskToEditValues(before), status: "done" as const, assignee: "tanaka" };
    const result = await saveTaskEdit(3, values, before.updatedAt, { fetch });
    assert.equal(result.status, "saved");
    assert.equal(getTask(3, db)!.status, "done");
    assert.equal(getTask(3, db)!.assignee, "tanaka");
  });

  for (const [label, change] of [
    ["タイトルが空", { title: "" }],
    ["タイトルが空白だけ", { title: "   " }],
    ["期限が空", { dueDate: "" }],
    ["メモが長すぎる", { memo: "あ".repeat(2001) }],
    ["担当者がいない", { assignee: "nobody" }],
  ] as const) {
    it(`${label}なら、日本語の理由が返り、タスクは変わらない`, async () => {
      const db = openDb();
      const before = getTask(3, db)!;
      const { fetch } = fakeServer(db);
      const result = await saveTaskEdit(3, { ...taskToEditValues(before), ...change }, before.updatedAt, { fetch });
      assert.equal(result.status, "invalid");
      assert.ok(result.status === "invalid" && result.messages.length > 0);
      assert.ok(result.status === "invalid" && result.messages.every((m) => /[ぁ-んァ-ン一-龠]/.test(m)));
      assert.deepEqual(getTask(3, db), before);
    });
  }

  it("フォームを開いた後にほかの人が保存していたら conflict で、上書きせず、最新のタスクと知らせる文言が返る", async () => {
    const db = openDb();
    const opened = getTask(3, db)!;
    updateTask(3, { dueDate: "2031-01-31" }, db); // ほかの人が先に保存する
    const latest = getTask(3, db)!;
    const { fetch } = fakeServer(db);
    const result = await saveTaskEdit(3, { ...taskToEditValues(opened), title: "自分の変更" }, opened.updatedAt, { fetch });
    assert.equal(result.status, "conflict");
    assert.ok(result.status === "conflict" && result.message.includes("ほかの人が先に更新しました"));
    assert.equal(TASK_EDIT_CONFLICT_MESSAGE, "ほかの人が先に更新しました。相手が変えた項目を下に並べます。");
    assert.ok(result.status === "conflict");
    assert.deepEqual(result.task, latest);
    assert.deepEqual(getTask(3, db), latest);
    // 「今の値で編集し直す」で入れる値は最新のもの
    assert.equal(taskToEditValues(result.task).dueDate, "2031-01-31");
  });

  it("conflict の後に最新の値で入れ直して保存すると、同じ衝突をくり返さずに保存できる", async () => {
    const db = openDb();
    const opened = getTask(3, db)!;
    updateTask(3, { memo: "ほかの人のメモ" }, db);
    const { fetch } = fakeServer(db);
    const first = await saveTaskEdit(3, taskToEditValues(opened), opened.updatedAt, { fetch });
    assert.ok(first.status === "conflict");
    const retry = await saveTaskEdit(3, { ...taskToEditValues(first.task), title: "読み直してから直した" }, first.task.updatedAt, { fetch });
    assert.equal(retry.status, "saved");
    const after = getTask(3, db)!;
    assert.equal(after.title, "読み直してから直した");
    assert.equal(after.memo, "ほかの人のメモ");
  });

  it("409 の応答に正しい形のタスクが無ければ、入れ直さずにエラーにする", async () => {
    const result = await saveTaskEdit(3, taskToEditValues(getTask(3, openDb())!), "2026-11-12T00:00:00.000Z", {
      fetch: async () => response(409, { error: "衝突" }),
    });
    assert.deepEqual(result, { status: "error", message: TASK_EDIT_FAILED_MESSAGE });
  });

  it("編集中にタスクが消されていたら（404）、見つからないと返す", async () => {
    const db = openDb();
    const task = getTask(3, db)!;
    assert.equal(deleteTask(3, "sato", db), "deleted");
    const { fetch } = fakeServer(db);
    const result = await saveTaskEdit(3, taskToEditValues(task), task.updatedAt, { fetch });
    assert.deepEqual(result, { status: "error", message: TASK_EDIT_NOT_FOUND_MESSAGE });
  });

  it("ログインが切れていたら（401）unauthorized", async () => {
    const result = await saveTaskEdit(3, taskToEditValues(getTask(3, openDb())!), "2026-11-12T00:00:00.000Z", {
      fetch: async () => response(401, { error: "ログインしてください" }),
    });
    assert.deepEqual(result, { status: "unauthorized" });
  });

  it("通信に失敗したら、保存できなかったと返す", async () => {
    const result = await saveTaskEdit(3, taskToEditValues(getTask(3, openDb())!), "2026-11-12T00:00:00.000Z", {
      fetch: async () => {
        throw new Error("network");
      },
    });
    assert.deepEqual(result, { status: "error", message: TASK_EDIT_FAILED_MESSAGE });
  });
});

describe("newerTask（フォームを開くときに使うタスク）", () => {
  it("保存の直後で画面の値がまだ古いときは、受け取った新しいほうを使う", () => {
    const db = openDb();
    const shown = getTask(3, db)!;
    const received = updateTask(3, { title: "保存した" }, db)!;
    assert.equal(newerTask(shown, received), received);
  });

  it("画面の値のほうが新しければ画面の値を使う（「やめる」で閉じた後も、今の値から始まる）", () => {
    const db = openDb();
    const received = getTask(3, db)!;
    const shown = updateTask(3, { title: "ほかの人が直した" }, db)!;
    assert.equal(newerTask(shown, received), shown);
    assert.equal(newerTask(shown, undefined), shown);
  });

  it("違うタスクの値は使わない", () => {
    const db = openDb();
    const shown = getTask(3, db)!;
    const other: Task = { ...getTask(4, db)!, updatedAt: "2099-01-01T00:00:00.000Z" };
    assert.equal(newerTask(shown, other), shown);
  });
});
