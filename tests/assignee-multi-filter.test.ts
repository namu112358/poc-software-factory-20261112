import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createTask, listTasks, parseAssignees } from "../src/lib/tasks.ts";
import { exportHref, parseTaskFilter } from "../src/lib/export.ts";
import { bulkSelectionKey } from "../src/lib/bulk-select.ts";
import { loadTaskViewPrefs, saveTaskViewPrefs } from "../src/lib/task-view-prefs.ts";

function setup() {
  const db = openDb();
  db.prepare("DELETE FROM tasks").run();
  const mk = (title: string, assignee: string, status: "todo" | "done" = "todo") =>
    createTask({ title, status, assignee, dueDate: "", priority: "low", memo: "" }, db).id;
  const sato = mk("佐藤", "sato");
  const suzuki = mk("鈴木", "suzuki");
  const satoDone = mk("佐藤済", "sato", "done");
  const other = (db.prepare("SELECT id FROM users WHERE id NOT IN ('sato','suzuki') LIMIT 1").get() as { id: string } | undefined)?.id;
  const third = other ? mk("第三者", other) : undefined;
  return { db, sato, suzuki, satoDone, third };
}
const found = (db: ReturnType<typeof openDb>, assignees: string[], extra: object = {}) => listTasks({ assignees, ...extra }, db).map((t) => t.id).sort((a, b) => a - b);
const sorted = (...ids: (number | undefined)[]) => ids.filter((i): i is number => i !== undefined).sort((a, b) => a - b);

describe("複数担当者の絞り込み", () => {
  it("2 人選ぶと、どちらかが担当のタスクだけが出る", () => {
    const { db, sato, suzuki, satoDone } = setup();
    assert.deepEqual(found(db, ["sato", "suzuki"]), sorted(sato, suzuki, satoDone));
  });

  it("「担当者なし」と 1 人を選ぶと、担当者のいないタスクとその人のタスクが出る", () => {
    const { db, sato, satoDone, suzuki } = setup();
    assert.deepEqual(found(db, ["none", "sato"]), sorted(sato, satoDone));
    assert.deepEqual(found(db, ["none"]), []);
    assert.deepEqual(found(db, ["none", "suzuki"]), sorted(suzuki));
  });

  it("1 人だけ選んだときは今と同じ（assignees でも assignee でも同じ結果）", () => {
    const { db, sato, satoDone } = setup();
    assert.deepEqual(found(db, ["sato"]), sorted(sato, satoDone));
    assert.deepEqual(listTasks({ assignee: "sato" }, db).map((t) => t.id).sort((a, b) => a - b), sorted(sato, satoDone));
  });

  it("指定なしなら全件", () => {
    const { db } = setup();
    assert.equal(found(db, []).length, listTasks({}, db).length);
  });

  it("ほかの絞り込みと組み合わせると、すべての条件を満たすタスクだけが出る", () => {
    const { db, sato, suzuki } = setup();
    assert.deepEqual(found(db, ["sato", "suzuki"], { status: "todo" }), sorted(sato, suzuki));
  });

  it("今は無い担当者・不正な値・重複は、その分だけ無視する", () => {
    const { db } = setup();
    assert.deepEqual(parseAssignees(["sato", "ghost", "", 5, "sato", "none"], db), ["sato", "none"]);
    assert.deepEqual(parseAssignees("suzuki", db), ["suzuki"]);
    assert.deepEqual(parseAssignees(undefined, db), []);
    assert.deepEqual(parseAssignees(["ghost"], db), []);
  });

  it("SQL の記号を含む値でも、値として扱われる", () => {
    const { db } = setup();
    assert.deepEqual(parseAssignees(["' OR 1=1 --"], db), []);
    assert.deepEqual(found(db, ["' OR 1=1 --"]), []);
  });

  it("CSV の条件と URL: 複数の担当者を読み、同じ形の URL に戻す", () => {
    const { db } = setup();
    const filter = parseTaskFilter(new URLSearchParams("assignee=sato&assignee=suzuki&assignee=ghost"), db);
    assert.deepEqual(filter.assignees, ["sato", "suzuki"]);
    assert.equal(exportHref(filter), "/api/tasks/export?assignee=sato&assignee=suzuki");
    assert.equal(exportHref({ assignee: "sato" }), "/api/tasks/export?assignee=sato");
  });

  it("覚えた条件に複数の担当者が残り、古い形（1 人の文字列）も読める", () => {
    const { db } = setup();
    const user = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
    saveTaskViewPrefs(user, { assignee: ["sato", "none", "ghost"] }, db);
    assert.deepEqual(loadTaskViewPrefs(user, db).assignee, ["sato", "none"]);
    saveTaskViewPrefs(user, { assignee: "suzuki" }, db);
    assert.deepEqual(loadTaskViewPrefs(user, db).assignee, ["suzuki"]);
  });

  it("選択の状態のキーは、担当者の選び方で変わる", () => {
    assert.notEqual(bulkSelectionKey({ assignees: ["sato"] }), bulkSelectionKey({ assignees: ["sato", "suzuki"] }));
  });
});
