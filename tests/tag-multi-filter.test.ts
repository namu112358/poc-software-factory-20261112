import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { addTag } from "../src/lib/tags.ts";
import { listTasks, parseTagFilters } from "../src/lib/tasks.ts";
import { exportTasksCsv, parseTaskFilter } from "../src/lib/export.ts";
import { loadTaskViewPrefs, saveTaskViewPrefs } from "../src/lib/task-view-prefs.ts";

function setup() {
  const db = openDb();
  const ids = (db.prepare("SELECT id FROM tasks ORDER BY id").all() as { id: number }[]).map((r) => r.id);
  db.prepare("DELETE FROM task_tags").run();
  const [a, b, c] = ids;
  addTag(a, "急ぎ", db);
  addTag(a, "顧客A", db);
  addTag(b, "急ぎ", db);
  addTag(c, "顧客A", db);
  return { db, a, b, c, ids };
}
const found = (db: ReturnType<typeof openDb>, tags: string[]) => listTasks({ tags }, db).map((t) => t.id);

describe("複数タグの絞り込み", () => {
  it("2 つ選ぶと、両方が付いたタスクだけが出る（片方だけは出ない）", () => {
    const { db, a } = setup();
    assert.deepEqual(found(db, ["急ぎ", "顧客A"]), [a]);
  });

  it("1 つだけ選んだときは、そのタグが付いたタスクがすべて出る", () => {
    const { db, a, b } = setup();
    assert.deepEqual(found(db, ["急ぎ"]).sort(), [a, b].sort());
    assert.deepEqual(listTasks({ tag: "急ぎ" }, db).map((t) => t.id).sort(), [a, b].sort());
  });

  it("選べるのは 5 つまで。6 つ目以降は無視する", () => {
    const { db, a } = setup();
    for (const n of ["t1", "t2", "t3", "t4", "t5"]) addTag(a, n, db);
    addTag(a + 1, "t1", db);
    assert.deepEqual(parseTagFilters(["急ぎ", "顧客A", "t1", "t2", "t3", "t4"], db), ["急ぎ", "顧客A", "t1", "t2", "t3"]);
    // 6 つ目の t4 は付いていない別のタスクでも、無視されるので結果に影響しない
    assert.deepEqual(found(db, parseTagFilters(["急ぎ", "顧客A", "t1", "t2", "t3", "t4"], db)), [a]);
  });

  it("使われていないタグ・空・長すぎる値・重複は、その分だけ無視する", () => {
    const { db } = setup();
    assert.deepEqual(parseTagFilters(["急ぎ", "無いタグ", " ", "", "x".repeat(41), "急ぎ"], db), ["急ぎ"]);
    assert.deepEqual(parseTagFilters("急ぎ", db), ["急ぎ"]);
    assert.deepEqual(parseTagFilters(undefined, db), []);
    assert.deepEqual(parseTagFilters(["無いタグ"], db), []);
  });

  it("ほかの絞り込みと組み合わせると、すべてを満たすタスクだけが出る", () => {
    const { db, a, b } = setup();
    db.prepare("UPDATE tasks SET status = 'todo' WHERE id = ?").run(a);
    db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(b);
    assert.deepEqual(listTasks({ tags: ["急ぎ"], status: "done" }, db).map((t) => t.id), [b]);
    assert.deepEqual(listTasks({ tags: ["急ぎ", "顧客A"], status: "done" }, db), []);
  });

  it("CSV のダウンロードにも同じ条件が効く", () => {
    const { db, a } = setup();
    const filter = parseTaskFilter(new URLSearchParams("tag=急ぎ&tag=顧客A"), db);
    const lines = exportTasksCsv(filter, db).trim().split("\r\n");
    assert.equal(lines.length, 2);
    assert.ok(lines[1].startsWith(`${a},`));
  });

  it("覚えた条件に複数のタグが残り、昔の 1 つだけの形も読める", () => {
    const { db } = setup();
    const user = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
    saveTaskViewPrefs(user, { tag: ["急ぎ", "顧客A", "無いタグ"] }, db);
    assert.deepEqual(loadTaskViewPrefs(user, db).tag, ["急ぎ", "顧客A"]);
    db.prepare("UPDATE task_view_prefs SET query = ? WHERE user_id = ?").run(JSON.stringify({ tag: "急ぎ" }), user);
    assert.deepEqual(loadTaskViewPrefs(user, db).tag, ["急ぎ"]);
  });
});
