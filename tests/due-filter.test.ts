import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { addDays, createTask, listTasks, parseDueFilter, todayInJapan } from "../src/lib/tasks.ts";
import { listTasksByQuery } from "../src/lib/task-query.ts";
import { exportHref, parseTaskFilter } from "../src/lib/export.ts";

const TODAY = "2026-11-12";

function setup() {
  const db = openDb();
  db.exec("DELETE FROM tasks");
  const mk = (title: string, dueDate: string, extra: Record<string, unknown> = {}) =>
    createTask({ title, status: "todo", assignee: "sato", dueDate, ...extra } as never, db).id;
  const ids = {
    past: mk("past", "2026-11-11"),
    today: mk("today", TODAY),
    edge7: mk("edge7", "2026-11-19"),
    after7: mk("after7", "2026-11-20"),
  };
  return { db, ids };
}
const titles = (db: ReturnType<typeof openDb>, due?: "overdue" | "today" | "week" | "none") =>
  listTasks({ due, today: TODAY }, db).map((t) => t.title).sort();

describe("due filter", () => {
  it("overdue: only due dates before today", () => {
    const { db } = setup();
    assert.deepEqual(titles(db, "overdue"), ["past"]);
  });
  it("today: due today or earlier (includes overdue)", () => {
    const { db } = setup();
    assert.deepEqual(titles(db, "today"), ["past", "today"]);
  });
  it("week: due up to 7 days after today (includes overdue)", () => {
    const { db } = setup();
    assert.deepEqual(titles(db, "week"), ["edge7", "past", "today"]);
  });
  it("none: only tasks with no due date (the column is NOT NULL, so unset means empty)", () => {
    const { db } = setup();
    db.prepare("UPDATE tasks SET due_date = '' WHERE title = 'after7'").run();
    assert.deepEqual(titles(db, "none"), ["after7"]);
    assert.deepEqual(titles(db, "overdue"), ["past"]);
    assert.deepEqual(titles(db, "week"), ["edge7", "past", "today"]);
  });
  it("no filter returns everything", () => {
    const { db } = setup();
    assert.equal(titles(db).length, 4);
  });
  it("combines with other filters", () => {
    const { db } = setup();
    db.prepare("UPDATE tasks SET status = 'done' WHERE title = 'past'").run();
    assert.deepEqual(listTasks({ due: "week", status: "todo", today: TODAY }, db).map((t) => t.title).sort(), ["edge7", "today"]);
  });
});

describe("due query", () => {
  it("parseDueFilter accepts the four values and ignores anything else", () => {
    for (const v of ["overdue", "today", "week", "none"]) assert.equal(parseDueFilter(v), v);
    for (const v of ["", "bogus", null, undefined, 1]) assert.equal(parseDueFilter(v), undefined);
  });
  it("invalid due in the URL does not filter", () => {
    const { db } = setup();
    const filter = parseTaskFilter(new URLSearchParams("due=bogus"), db);
    assert.equal(filter.due, undefined);
    assert.equal(listTasks({ ...filter, today: TODAY }, db).length, 4);
  });
  it("the API list (GET /api/tasks) filters by due like the list page (#425)", () => {
    const { db } = setup();
    const now = new Date("2026-11-12T03:00:00Z");
    assert.deepEqual(listTasksByQuery(new URLSearchParams("due=overdue"), db, now).map((t) => t.title), ["past"]);
  });
  it("CSV export link and parser carry due", () => {
    assert.equal(exportHref({ due: "week" }), "/api/tasks/export?due=week");
    assert.equal(parseTaskFilter(new URLSearchParams("due=week"), openDb()).due, "week");
    assert.equal(parseTaskFilter(new URLSearchParams("due=x"), openDb()).due, undefined);
  });
});

describe("today in Japan", () => {
  it("uses the Japan date for the cutoff (UTC 2026-11-11 15:30 is already 11-12 in Japan)", () => {
    assert.equal(todayInJapan(new Date("2026-11-11T15:30:00Z")), "2026-11-12");
    assert.equal(addDays("2026-11-12", 7), "2026-11-19");
  });
});
