import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import {
  BULK_SELECT_MAX,
  bulkChanges,
  bulkSelectionKey,
  canSelectMore,
  canSubmitBulk,
  confirmAndBulkUpdate,
  keepVisible,
  toggleSelection,
} from "../src/lib/bulk-select.ts";
import { BULK_UPDATE_MAX, updateTasks, validateBulkUpdateInput } from "../src/lib/bulk-update.ts";
import { deleteTask, getTask, listTasks } from "../src/lib/tasks.ts";
import { listUserOptions } from "../src/lib/users.ts";

// 初期データ: 担当者 1 sato、2 suzuki、3 sato、4 tanaka、5 suzuki、6 sato、7 tanaka。
const USERS = [
  { id: "sato", name: "佐藤" },
  { id: "suzuki", name: "鈴木" },
  { id: "tanaka", name: "田中" },
];

type Call = { url: string; body: unknown };

/** 画面から送る要求を、API と同じ検証と更新に通す偽の通信。全部か無しかの振る舞いは本物の関数で確かめる。 */
function apiOn(db: ReturnType<typeof openDb>, calls: Call[] = []) {
  return async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const input = validateBulkUpdateInput(body, db);
    if (!input.ok) return { ok: false, status: 400, json: async () => ({ error: "入力内容に誤りがあります", details: input.errors }) };
    const r = updateTasks(input.value.ids, input.value.changes, db);
    if (!r.ok) return { ok: false, status: 404, json: async () => ({ error: "タスクが見つかりません" }) };
    return { ok: true, status: 200, json: async () => ({ tasks: r.tasks }) };
  };
}

const ok = () => true;

describe("まとめて変更（画面の処理）", () => {
  it("3 件を選び担当者を鈴木に替えると、3 件とも鈴木になり「3 件を変更しました」と出る", async () => {
    const db = openDb();
    const r = await confirmAndBulkUpdate([1, 3, 4], { assignee: "suzuki", status: "" }, USERS, { confirm: ok, fetch: apiOn(db) });
    assert.deepEqual(r, { status: "updated", count: 3, message: "3 件を変更しました" });
    for (const id of [1, 3, 4]) assert.equal(getTask(id, db)?.assignee, "suzuki");
    assert.equal(getTask(2, db)?.assignee, "suzuki");
    assert.equal(getTask(6, db)?.assignee, "sato", "選んでいないタスクは変わらない");
  });

  it("担当者だけ・ステータスだけ・両方のどれでも替えられ、選んだ項目だけを送る", async () => {
    const db = openDb();
    const calls: Call[] = [];
    const deps = { confirm: ok, fetch: apiOn(db, calls) };
    await confirmAndBulkUpdate([4], { assignee: "sato", status: "" }, USERS, deps);
    assert.deepEqual(calls.at(-1)?.body, { ids: [4], changes: { assignee: "sato" } });
    assert.deepEqual([getTask(4, db)?.assignee, getTask(4, db)?.status], ["sato", "todo"]);

    await confirmAndBulkUpdate([5], { assignee: "", status: "in_progress" }, USERS, deps);
    assert.deepEqual(calls.at(-1)?.body, { ids: [5], changes: { status: "in_progress" } });
    assert.deepEqual([getTask(5, db)?.assignee, getTask(5, db)?.status], ["suzuki", "in_progress"]);

    await confirmAndBulkUpdate([6], { assignee: "tanaka", status: "done" }, USERS, deps);
    assert.deepEqual(calls.at(-1)?.body, { ids: [6], changes: { assignee: "tanaka", status: "done" } });
    assert.deepEqual([getTask(6, db)?.assignee, getTask(6, db)?.status], ["tanaka", "done"]);
    assert.equal(calls.every((c) => c.url === "/api/tasks/bulk-update"), true);
  });

  it("担当者もステータスも選ばない・タスクを選ばないときは「まとめて変更」を押せず、何も送らない", async () => {
    assert.equal(canSubmitBulk([1, 2], { assignee: "", status: "" }), false);
    assert.equal(canSubmitBulk([], { assignee: "suzuki", status: "done" }), false);
    assert.equal(canSubmitBulk([1], { assignee: "suzuki", status: "" }), true);
    assert.equal(canSubmitBulk([1], { assignee: "", status: "done" }), true);
    assert.equal(canSubmitBulk([1], { assignee: "", status: "bogus" }), false, "不正なステータスは選んでいないのと同じ");

    const calls: Call[] = [];
    let asked = false;
    const r = await confirmAndBulkUpdate([1], { assignee: "", status: "" }, USERS, {
      confirm: () => ((asked = true), true),
      fetch: apiOn(openDb(), calls),
    });
    assert.deepEqual(r, { status: "cancelled" });
    assert.equal(asked, false);
    assert.equal(calls.length, 0);
  });

  it("確認のダイアログに件数と変更の中身が出て、キャンセルすると何も送らず何も変わらない", async () => {
    const db = openDb();
    const before = listTasks({}, db);
    const calls: Call[] = [];
    let message = "";
    const r = await confirmAndBulkUpdate([1, 2, 3], { assignee: "suzuki", status: "done" }, USERS, {
      confirm: (m) => ((message = m), false),
      fetch: apiOn(db, calls),
    });
    assert.deepEqual(r, { status: "cancelled" });
    assert.match(message, /3 件/);
    assert.match(message, /担当者を「鈴木」/);
    assert.match(message, /ステータスを「完了」/);
    assert.equal(calls.length, 0);
    assert.deepEqual(listTasks({}, db), before);
  });

  it("選んでいる間に 1 件が消されていたら、1 件も変わらず「見つからないタスクがあります」と出る", async () => {
    const db = openDb();
    assert.equal(deleteTask(2, "suzuki", db), "deleted");
    const before = listTasks({}, db);
    const r = await confirmAndBulkUpdate([1, 2, 3], { assignee: "tanaka", status: "todo" }, USERS, { confirm: ok, fetch: apiOn(db) });
    assert.equal(r.status, "error");
    assert.match(r.status === "error" ? r.message : "", /見つからないタスクがあります/);
    assert.deepEqual(listTasks({}, db), before);
  });

  it("API が入力の誤りを返したら理由を日本語で出し、成功とは扱わない", async () => {
    const db = openDb();
    const r = await confirmAndBulkUpdate([1], { assignee: "nobody", status: "" }, USERS, { confirm: ok, fetch: apiOn(db) });
    assert.deepEqual(r, { status: "error", message: "担当者が存在しません。1 件も変更していません。" });
    assert.equal(getTask(1, db)?.assignee, "sato");
  });

  it("未ログイン・通信の失敗でも、成功とは扱わず日本語で理由を出す", async () => {
    // ログインが切れていたら（401）、ほかの誤りとは分けて expired にする（画面は選択を残し、ログインし直す案内を出す。#491）。
    const unauthorized = await confirmAndBulkUpdate([1], { assignee: "sato", status: "" }, USERS, {
      confirm: ok,
      fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: "ログインが必要です" }) }),
    });
    assert.deepEqual(unauthorized, { status: "expired", message: "1 件も変更していません。" });
    const offline = await confirmAndBulkUpdate([1], { assignee: "sato", status: "" }, USERS, {
      confirm: ok,
      fetch: async () => {
        throw new Error("network");
      },
    });
    assert.deepEqual(offline, { status: "error", message: "変更できませんでした。1 件も変更していません。" });
  });

  it("担当者の候補には、タスクを持たない利用者も含まれ、その人に替えられる", async () => {
    const db = openDb();
    db.prepare("INSERT INTO users (id, name, password_hash) VALUES (?, ?, ?)").run("yamada", "山田", "x");
    const users = listUserOptions(db);
    assert.ok(users.some((u) => u.id === "yamada"));
    const r = await confirmAndBulkUpdate([1, 2], { assignee: "yamada", status: "" }, users, { confirm: ok, fetch: apiOn(db) });
    assert.equal(r.status, "updated");
    assert.equal(getTask(1, db)?.assignee, "yamada");
  });
});

describe("選択", () => {
  it("一度に選べるのは 100 件までで、101 件目は選べない（API の上限と同じ）", () => {
    assert.equal(BULK_SELECT_MAX, BULK_UPDATE_MAX);
    let selected: number[] = [];
    for (let id = 1; id <= 100; id++) selected = toggleSelection(selected, id, true);
    assert.equal(selected.length, 100);
    assert.equal(canSelectMore(selected, 101), false);
    assert.deepEqual(toggleSelection(selected, 101, true), selected);
    assert.equal(canSelectMore(selected, 50), true, "選んだ行は外せる");
    const fewer = toggleSelection(selected, 50, false);
    assert.equal(fewer.length, 99);
    assert.equal(canSelectMore(fewer, 101), true, "1 件外せば、また選べる");
    assert.equal(toggleSelection(fewer, 101, true).length, 100);
  });

  it("同じタスクを 2 回選んでも 1 件と数える", () => {
    assert.deepEqual(toggleSelection([3], 3, true), [3]);
  });

  it("絞り込み・並び順・アーカイブの表示のどれかを変えると、選択の状態を作り直すキーが変わる", () => {
    const base = { status: "todo", assignee: "sato", tag: "バグ", q: "API", sort: "priority", includeArchived: false };
    const key = bulkSelectionKey(base);
    assert.equal(bulkSelectionKey({ ...base }), key, "同じ絞り込みなら同じ");
    for (const changed of [
      { status: undefined },
      { assignee: "none" },
      { tag: undefined },
      { q: "DB" },
      { sort: "created" },
      { includeArchived: true },
    ]) {
      assert.notEqual(bulkSelectionKey({ ...base, ...changed }), key, JSON.stringify(changed));
    }
  });

  it("読み込み直して一覧から消えたタスクは、選択から外れる", () => {
    assert.deepEqual(keepVisible([1, 2, 3], [1, 3, 4]), [1, 3]);
  });

  it("送る変更には、選んだ項目だけが入る", () => {
    assert.deepEqual(bulkChanges({ assignee: "", status: "" }), {});
    assert.deepEqual(bulkChanges({ assignee: "sato", status: "todo" }), { assignee: "sato", status: "todo" });
  });
});
