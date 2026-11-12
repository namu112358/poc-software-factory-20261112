import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { addTag, listTags, renameTag, validateTagRenameInput } from "../src/lib/tags.ts";
import { getTask } from "../src/lib/tasks.ts";

// POST /api/tags/rename（src/app/api/tags/rename/route.ts）は、ここで確かめる検証と付け替えをそのまま呼ぶ。
// ルートは next/server を読み込むため単体テストから呼べない。200・400・401・404 の応答は起動して確かめた。

function tagsOf(db: Db, ids: number[]): Record<number, string[]> {
  return Object.fromEntries(ids.map((id) => [id, listTags(id, db)]));
}

describe("validateTagRenameInput", () => {
  it("accepts from and to, trimming spaces", () => {
    assert.deepEqual(validateTagRenameInput({ from: " bug ", to: "バグ " }), { ok: true, value: { from: "bug", to: "バグ" } });
  });

  it("accepts a 20-character to and treats names differing only in case as different", () => {
    assert.equal(validateTagRenameInput({ from: "bug", to: "あ".repeat(20) }).ok, true);
    assert.equal(validateTagRenameInput({ from: "bug", to: "🔥".repeat(20) }).ok, true);
    assert.deepEqual(validateTagRenameInput({ from: "bug", to: "Bug" }), { ok: true, value: { from: "bug", to: "Bug" } });
  });

  it("rejects an empty or too long to", () => {
    for (const to of ["", "   ", "a".repeat(21), "🔥".repeat(21)]) {
      assert.equal(validateTagRenameInput({ from: "bug", to }).ok, false, `to=${JSON.stringify(to)}`);
    }
  });

  it("rejects the same from and to, including after trimming", () => {
    assert.equal(validateTagRenameInput({ from: "bug", to: "bug" }).ok, false);
    assert.equal(validateTagRenameInput({ from: "bug", to: " bug " }).ok, false);
  });

  it("rejects a missing, empty or non-string from/to, forbidden characters, and non-object bodies", () => {
    const bad = [{ to: "バグ" }, { from: "bug" }, { from: "", to: "バグ" }, { from: 1, to: "バグ" }, { from: "bug", to: null }, { from: "bug", to: "a b" }, { from: "bug", to: "a/b" }, null, undefined, "x", [], {}];
    for (const body of bad) assert.equal(validateTagRenameInput(body).ok, false, JSON.stringify(body));
  });
});

describe("renameTag", () => {
  it("renames the tag on every task that has it and returns the number of tasks", () => {
    const db = openDb();
    addTag(1, "bug", db);
    addTag(2, "bug", db);
    addTag(3, "急ぎ", db);
    assert.deepEqual(renameTag("bug", "バグ", db), { ok: true, count: 2 });
    assert.deepEqual(tagsOf(db, [1, 2, 3]), { 1: ["バグ"], 2: ["バグ"], 3: ["急ぎ"] });
  });

  it("only removes from on tasks that already have to, without duplicating to", () => {
    const db = openDb();
    addTag(1, "バグ", db);
    addTag(1, "bug", db);
    addTag(2, "bug", db);
    assert.deepEqual(renameTag("bug", "バグ", db), { ok: true, count: 2 });
    assert.deepEqual(tagsOf(db, [1, 2]), { 1: ["バグ"], 2: ["バグ"] });
  });

  it("returns not_found and changes nothing when no task has from", () => {
    const db = openDb();
    addTag(1, "バグ", db);
    assert.deepEqual(renameTag("bug", "バグ", db), { ok: false, reason: "not_found" });
    assert.deepEqual(tagsOf(db, [1]), { 1: ["バグ"] });
  });

  it("leaves other tags untouched and keeps the renamed tag in its original position", () => {
    const db = openDb();
    addTag(1, "急ぎ", db);
    addTag(1, "bug", db);
    addTag(1, "UI", db);
    addTag(2, "Bug", db);
    renameTag("bug", "バグ", db);
    assert.deepEqual(tagsOf(db, [1, 2]), { 1: ["急ぎ", "バグ", "UI"], 2: ["Bug"] });
  });

  it("also renames the tag on archived tasks", () => {
    const db = openDb();
    addTag(1, "bug", db);
    db.prepare("UPDATE tasks SET archived = 1 WHERE id = 1").run();
    assert.deepEqual(renameTag("bug", "バグ", db), { ok: true, count: 1 });
    assert.deepEqual(listTags(1, db), ["バグ"]);
  });

  it("does not change the tasks' last updated time", () => {
    const db = openDb();
    addTag(1, "bug", db);
    const before = getTask(1, db)!.updatedAt;
    renameTag("bug", "バグ", db);
    assert.equal(getTask(1, db)!.updatedAt, before);
  });

  it("changes no task when a write fails partway (all or nothing)", () => {
    const db = openDb();
    addTag(1, "バグ", db);
    addTag(1, "bug", db);
    addTag(2, "bug", db);
    addTag(3, "bug", db);
    // タスク 3 の付け替えだけを失敗させる。タスク 1 の bug を外す処理とタスク 2 の付け替えは先に済む。
    db.exec(`CREATE TRIGGER fail_rename BEFORE UPDATE ON task_tags WHEN NEW.task_id = 3 BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    assert.throws(() => renameTag("bug", "バグ", db), /boom/);
    assert.deepEqual(tagsOf(db, [1, 2, 3]), { 1: ["バグ", "bug"], 2: ["bug"], 3: ["bug"] });
    // 失敗の後も DB は使える（トランザクションが残っていない）。
    db.exec("DROP TRIGGER fail_rename");
    assert.deepEqual(renameTag("bug", "バグ", db), { ok: true, count: 3 });
  });
});
