import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { addTag, listTags, resolveTagName, tagKey, toHalfWidthAlnum, validateTagInput } from "../src/lib/tags.ts";

/** 揃える仕組みができる前から保存されているタグを、そのまま入れる。 */
function insertRaw(db: Db, taskId: number, name: string) {
  db.prepare("INSERT INTO task_tags (task_id, name) VALUES (?, ?)").run(taskId, name);
}

/** POST /api/tasks/:id/tags と画面のタグの追加は、同じ検証と addTag を通る。 */
function postTag(db: Db, taskId: number, name: unknown) {
  const r = validateTagInput({ name });
  assert.ok(r.ok);
  return addTag(taskId, r.value.name, db);
}

function allNames(db: Db): string[] {
  return (db.prepare("SELECT name FROM task_tags ORDER BY id").all() as { name: string }[]).map((r) => r.name);
}

describe("揃え方の判定（tagKey・toHalfWidthAlnum・resolveTagName）", () => {
  it("全角の英数字を半角にし、英字の大文字・小文字の違いを無視して比べる", () => {
    for (const s of ["bug", "Bug", "BUG", "ｂｕｇ", "ＢＵＧ", "ｂUg"]) assert.equal(tagKey(s), "bug", s);
    assert.equal(tagKey("ｖ２"), "v2");
    assert.notEqual(tagKey("bug"), tagKey("bugs"));
  });

  it("日本語・全角の記号・半角カナ・絵文字は変えない", () => {
    for (const s of ["バグ", "ばぐ", "急ぎ", "ﾊﾞｸﾞ", "＃急ぎ", "🔥"]) {
      assert.equal(toHalfWidthAlnum(s), s);
      assert.equal(tagKey(s), s);
    }
    assert.notEqual(tagKey("バグ"), tagKey("ﾊﾞｸﾞ"));
  });

  it("使われていなければ、全角の英数字だけを半角にし、大文字・小文字は入力のまま", () => {
    assert.equal(resolveTagName("ＵＩ", []), "UI");
    assert.equal(resolveTagName("Ｖ２対応", []), "V2対応");
    assert.equal(resolveTagName("Bug", [{ name: "bugs", count: 1, firstId: 1 }]), "Bug");
  });

  it("使われている書き方が複数あれば、件数の多い方、同数なら先に作られた方に揃える", () => {
    const used = [
      { name: "Bug", count: 1, firstId: 1 },
      { name: "bug", count: 2, firstId: 5 },
    ];
    assert.equal(resolveTagName("BUG", used), "bug");
    const tie = [
      { name: "bug", count: 2, firstId: 7 },
      { name: "Bug", count: 2, firstId: 3 },
    ];
    assert.equal(resolveTagName("ｂｕｇ", tie), "Bug");
  });
});

describe("タグを付けるときに、使われている書き方に揃える", () => {
  it("「bug」が使われているときに「Bug」「BUG」「ｂｕｇ」を付けると「bug」が付く", () => {
    const db = openDb();
    addTag(1, "bug", db);
    assert.equal(postTag(db, 2, "Bug"), "added");
    assert.equal(postTag(db, 3, "BUG"), "added");
    assert.equal(postTag(db, 4, "ｂｕｇ"), "added");
    for (const id of [2, 3, 4]) assert.deepEqual(listTags(id, db), ["bug"]);
  });

  it("使われていない「ＵＩ」は「UI」として付く", () => {
    const db = openDb();
    assert.equal(postTag(db, 1, "ＵＩ"), "added");
    assert.deepEqual(listTags(1, db), ["UI"]);
  });

  it("すでに「bug」が付いているタスクに「Bug」を付けても「bug」1 つのまま（409 になる）", () => {
    const db = openDb();
    addTag(1, "bug", db);
    assert.equal(postTag(db, 1, "Bug"), "duplicate");
    assert.equal(postTag(db, 1, "ｂｕｇ"), "duplicate");
    assert.deepEqual(listTags(1, db), ["bug"]);
  });

  it("タスクに付いている書き方と揃える先が違っても、2 つ目は付けない", () => {
    const db = openDb();
    insertRaw(db, 1, "Bug");
    insertRaw(db, 2, "bug");
    insertRaw(db, 3, "bug");
    assert.equal(postTag(db, 1, "BUG"), "duplicate");
    assert.deepEqual(listTags(1, db), ["Bug"]);
  });

  it("日本語のタグは入力のまま付く", () => {
    const db = openDb();
    for (const name of ["ばぐ", "バグ", "不具合"]) assert.equal(postTag(db, 1, name), "added");
    assert.equal(postTag(db, 2, "ﾊﾞｸﾞ"), "added");
    assert.deepEqual(listTags(1, db), ["ばぐ", "バグ", "不具合"]);
    assert.deepEqual(listTags(2, db), ["ﾊﾞｸﾞ"]);
  });

  it("書き方が複数使われていれば、付いているタスクの多い方に揃える。同数なら先に作られた方", () => {
    const db = openDb();
    insertRaw(db, 1, "Bug");
    insertRaw(db, 2, "bug");
    insertRaw(db, 3, "bug");
    assert.equal(postTag(db, 4, "BUG"), "added");
    assert.deepEqual(listTags(4, db), ["bug"]);

    const db2 = openDb();
    insertRaw(db2, 1, "Ui");
    insertRaw(db2, 2, "ui");
    assert.equal(postTag(db2, 3, "UI"), "added");
    assert.deepEqual(listTags(3, db2), ["Ui"]);
  });

  it("アーカイブしたタスクにしか無い書き方にも揃える", () => {
    const db = openDb();
    addTag(1, "Bug", db);
    db.prepare("UPDATE tasks SET archived = 1 WHERE id = 1").run();
    assert.equal(postTag(db, 2, "bug"), "added");
    assert.deepEqual(listTags(2, db), ["Bug"]);
  });

  it("すでに保存されているタグは書き換えない", () => {
    const db = openDb();
    insertRaw(db, 1, "Bug");
    insertRaw(db, 2, "bug");
    insertRaw(db, 3, "ｂｕｇ");
    postTag(db, 4, "BUG");
    assert.deepEqual(allNames(db), ["Bug", "bug", "ｂｕｇ", "Bug"]);
  });
});
