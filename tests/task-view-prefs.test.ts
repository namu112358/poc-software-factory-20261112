import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { addTag } from "../src/lib/tags.ts";
import { clearTaskViewPrefs, hasTaskViewParams, loadTaskViewPrefs, resolveTaskViewQuery, saveTaskViewPrefs } from "../src/lib/task-view-prefs.ts";

function setup() {
  const db = openDb();
  const users = db.prepare("SELECT id FROM users ORDER BY id").all() as { id: string }[];
  addTag(1, "急ぎ", db);
  return { db, a: users[0].id, b: users[1].id };
}

describe("task view prefs", () => {
  it("保存した条件を、読み直すと同じ内容で返す", () => {
    const { db, a, b } = setup();
    saveTaskViewPrefs(a, { status: "todo", assignee: b, tag: "急ぎ", q: " 資料 ", due: "overdue", sort: "due", archived: "include" }, db);
    const loaded = loadTaskViewPrefs(a, db);
    assert.equal(loaded.status, "todo");
    assert.deepEqual(loaded.assignee, [b]);
    assert.deepEqual(loaded.tag, ["急ぎ"]);
    assert.equal(loaded.q, "資料");
    assert.equal(loaded.sort, "due");
    assert.equal(loaded.archived, "include");
  });

  it("不正な値・今は無いタグや担当者の項目は、指定なしとして扱う", () => {
    const { db, a } = setup();
    saveTaskViewPrefs(a, { status: "nope", assignee: "ghost", tag: "無いタグ", due: "x", sort: "bad", archived: "yes" }, db);
    assert.deepEqual(loadTaskViewPrefs(a, db), {});
    db.prepare("INSERT INTO task_view_prefs (user_id, query) VALUES (?, ?)").run(a, JSON.stringify({ status: "done", assignee: "ghost", sort: "zzz" }));
    assert.deepEqual(loadTaskViewPrefs(a, db), { status: "done" });
    db.prepare("UPDATE task_view_prefs SET query = ? WHERE user_id = ?").run("{壊れた", a);
    assert.deepEqual(loadTaskViewPrefs(a, db), {});
  });

  it("保存した後でタグが無くなったら、そのタグは使われない", () => {
    const { db, a } = setup();
    saveTaskViewPrefs(a, { tag: "急ぎ", status: "todo" }, db);
    db.prepare("DELETE FROM task_tags").run();
    assert.deepEqual(loadTaskViewPrefs(a, db), { status: "todo" });
  });

  it("ほかの利用者の覚えた条件は使われない", () => {
    const { db, a, b } = setup();
    saveTaskViewPrefs(a, { status: "done" }, db);
    assert.deepEqual(loadTaskViewPrefs(b, db), {});
    saveTaskViewPrefs(b, { sort: "due" }, db);
    assert.equal(loadTaskViewPrefs(a, db).status, "done");
  });

  it("条件を消すと、条件なしに戻る", () => {
    const { db, a } = setup();
    saveTaskViewPrefs(a, { status: "done" }, db);
    clearTaskViewPrefs(a, db);
    assert.deepEqual(loadTaskViewPrefs(a, db), {});
  });
});

describe("resolveTaskViewQuery", () => {
  it("URL に条件が無ければ覚えた条件を使う", () => {
    const { db, a } = setup();
    saveTaskViewPrefs(a, { status: "todo", sort: "priority" }, db);
    assert.deepEqual(resolveTaskViewQuery(a, {}, false, db), { status: "todo", sort: "priority" });
  });

  it("URL に条件があればそれを使い、覚えた条件の代わりに覚える", () => {
    const { db, a } = setup();
    saveTaskViewPrefs(a, { status: "todo" }, db);
    const params = { status: "done" };
    assert.deepEqual(resolveTaskViewQuery(a, params, false, db), params);
    assert.deepEqual(loadTaskViewPrefs(a, db), { status: "done" });
  });

  it("URL の条件が空の選択（すべて）でも、URL の条件として使い、覚えた条件を置き換える", () => {
    const { db, a } = setup();
    saveTaskViewPrefs(a, { status: "todo" }, db);
    assert.equal(hasTaskViewParams({ status: "" }), true);
    resolveTaskViewQuery(a, { status: "", assignee: "" }, false, db);
    assert.deepEqual(loadTaskViewPrefs(a, db), {});
  });

  it("解除のあとは、条件なしで出て、開き直しても条件なし", () => {
    const { db, a } = setup();
    saveTaskViewPrefs(a, { status: "todo" }, db);
    assert.deepEqual(resolveTaskViewQuery(a, { reset: "1" }, true, db), {});
    assert.deepEqual(resolveTaskViewQuery(a, {}, false, db), {});
  });
});
