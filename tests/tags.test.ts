import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { addTag, listTags, listTagsByTask, removeTag, validateTagInput } from "../src/lib/tags.ts";
import { listTasks, parseTagFilter } from "../src/lib/tasks.ts";

describe("validateTagInput", () => {
  it("trims the name and accepts 1-20 characters, case-sensitive", () => {
    assert.deepEqual(validateTagInput({ name: "  急ぎ " }), { ok: true, value: { name: "急ぎ" } });
    assert.equal(validateTagInput({ name: "a".repeat(20) }).ok, true);
    assert.deepEqual(validateTagInput({ name: "Bug" }), { ok: true, value: { name: "Bug" } });
    assert.equal(validateTagInput({ name: "🔥".repeat(20) }).ok, true);
    assert.equal(validateTagInput({ name: "🔥".repeat(21) }).ok, false);
  });

  it("rejects empty, too long, forbidden characters, non-string and non-object input", () => {
    const bad = [{ name: "" }, { name: "   " }, { name: "a".repeat(21) }, { name: "a b" }, { name: "a　b" }, { name: "a,b" }, { name: "a/b" }, { name: 1 }, {}, null, undefined, "x", []];
    for (const input of bad) assert.equal(validateTagInput(input).ok, false, JSON.stringify(input));
  });

  it("counts length after trimming", () => {
    assert.equal(validateTagInput({ name: ` ${"a".repeat(20)} ` }).ok, true);
  });
});

describe("addTag / listTags / removeTag", () => {
  it("lists tags oldest first and rejects a duplicate on the same task only", () => {
    const db = openDb();
    assert.deepEqual(listTags(1, db), []);
    assert.equal(addTag(1, "急ぎ", db), "added");
    assert.equal(addTag(1, "バグ", db), "added");
    assert.equal(addTag(1, "急ぎ", db), "duplicate");
    assert.equal(addTag(2, "急ぎ", db), "added");
    assert.deepEqual(listTags(1, db), ["急ぎ", "バグ"]);
    assert.deepEqual(listTags(2, db), ["急ぎ"]);
  });

  it("treats names differing only in case as different tags", () => {
    const db = openDb();
    assert.equal(addTag(1, "Bug", db), "added");
    assert.equal(addTag(1, "bug", db), "added");
    assert.deepEqual(listTags(1, db), ["Bug", "bug"]);
  });

  it("removes only the given tag, and reports one that is not attached", () => {
    const db = openDb();
    addTag(1, "a", db);
    addTag(2, "a", db);
    assert.equal(removeTag(1, "a", db), "removed");
    assert.equal(removeTag(1, "a", db), "not_found");
    assert.equal(removeTag(1, "zzz", db), "not_found");
    assert.deepEqual(listTags(2, db), ["a"]);
  });

  it("groups tags by task for the list page", () => {
    const db = openDb();
    addTag(1, "b", db);
    addTag(2, "x", db);
    addTag(1, "a", db);
    const map = listTagsByTask([1, 2, 3], db);
    assert.deepEqual(map.get(1), ["b", "a"]);
    assert.deepEqual(map.get(2), ["x"]);
    assert.equal(map.has(3), false);
    assert.equal(listTagsByTask([], db).size, 0);
  });
});

describe("listTasks with tag", () => {
  it("returns only tasks with the tag, combines with status, and returns [] for an unused tag", () => {
    const db = openDb();
    const all = listTasks({}, db);
    const [a, b] = all;
    addTag(a.id, "急ぎ", db);
    addTag(b.id, "急ぎ", db);
    assert.deepEqual(listTasks({ tag: "急ぎ" }, db).map((t) => t.id), [a.id, b.id]);
    assert.deepEqual(listTasks({ tag: "急ぎ", status: a.status }, db).map((t) => t.id).includes(a.id), true);
    const onlyA = listTasks({ tag: "急ぎ", status: a.status }, db);
    assert.ok(onlyA.every((t) => t.status === a.status));
    assert.deepEqual(listTasks({ tag: "ない" }, db), []);
    assert.equal(listTasks({}, db).length, all.length);
  });

  it("does not treat the tag value as SQL", () => {
    const db = openDb();
    assert.deepEqual(listTasks({ tag: "' OR 1=1 --" }, db), []);
  });
});

describe("parseTagFilter", () => {
  it("trims, and treats empty or non-string as no filter", () => {
    assert.equal(parseTagFilter(" 急ぎ "), "急ぎ");
    assert.equal(parseTagFilter(""), undefined);
    assert.equal(parseTagFilter("  "), undefined);
    assert.equal(parseTagFilter(null), undefined);
    assert.equal(parseTagFilter(["a"]), undefined);
  });
});
