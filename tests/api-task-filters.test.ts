// タスク一覧の API（GET /api/tasks）でも、画面と同じ絞り込み（複数の担当者・複数のタグ・期限）を使える（#425）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { listTasksByQuery, parseIncludeArchived, parseTaskListQuery } from "../src/lib/task-query.ts";
import { parseTaskFilter } from "../src/lib/export.ts";
import { addTag } from "../src/lib/tags.ts";
import {
  createTask,
  isTaskStatus,
  listTasks,
  parseAssignees,
  parseDueFilter,
  parseKeyword,
  parseSort,
  parseTagFilters,
  todayInJapan,
  updateTask,
} from "../src/lib/tasks.ts";

type Db = ReturnType<typeof openDb>;

/** 日本時間で 2026-11-12 の昼。 */
const NOON_JST = new Date("2026-11-12T03:00:00Z");

function setup() {
  const db = openDb();
  db.exec("DELETE FROM tasks");
  const mk = (title: string, assignee: string, dueDate: string, tags: string[] = [], status = "todo") => {
    const id = createTask({ title, status, assignee, dueDate } as never, db).id;
    for (const t of tags) addTag(id, t, db);
    return id;
  };
  const ids = {
    satoPast: mk("satoPast", "sato", "2026-11-11", ["急ぎ", "顧客A"]),
    satoToday: mk("satoToday", "sato", "2026-11-12", ["急ぎ"]),
    suzukiWeek: mk("suzukiWeek", "suzuki", "2026-11-19", ["急ぎ", "顧客A"]),
    suzukiLater: mk("suzukiLater", "suzuki", "2026-11-20", ["顧客A"]),
    tanakaPastDone: mk("tanakaPastDone", "tanaka", "2026-11-10", ["急ぎ", "顧客A"], "done"),
    tanakaLater: mk("tanakaLater", "tanaka", "2026-12-01"),
  };
  return { db, ids };
}

const qs = (s: string) => new URLSearchParams(s);
const titles = (db: Db, s: string, now: Date = NOON_JST) => listTasksByQuery(qs(s), db, now).map((t) => t.title).sort();
const enc = encodeURIComponent;

/** 一覧画面（src/app/tasks/page.tsx）と同じ組み立て。Next.js は同じキーが複数あると配列、1 つなら文字列で渡す。 */
function pageTitles(db: Db, s: string, now: Date = NOON_JST): string[] {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(qs(s).keys())) {
    const all = qs(s).getAll(key);
    raw[key] = all.length === 1 ? all[0] : all;
  }
  const status = isTaskStatus(raw.status) ? raw.status : undefined;
  return listTasks(
    {
      status,
      assignees: parseAssignees(raw.assignee, db),
      tags: parseTagFilters(raw.tag, db),
      q: parseKeyword(raw.q),
      due: parseDueFilter(raw.due),
      sort: parseSort(raw.sort),
      includeArchived: parseIncludeArchived(raw.archived),
      today: todayInJapan(now),
    },
    db,
  )
    .map((t) => t.title)
    .sort();
}

describe("GET /api/tasks: 複数の担当者", () => {
  it("assignee を 2 つ並べると、どちらかが担当のタスクが返る", () => {
    const { db } = setup();
    assert.deepEqual(titles(db, "assignee=sato&assignee=suzuki"), ["satoPast", "satoToday", "suzukiLater", "suzukiWeek"]);
  });

  it("none（担当者なし）もほかの担当者と組み合わせられる", () => {
    const { db } = setup();
    assert.deepEqual(parseTaskListQuery(qs("assignee=none&assignee=sato"), db).assignees, ["none", "sato"]);
    // 担当者は必須のため、今は担当者なしのタスクは無い。none を足しても佐藤の分は減らない。
    assert.deepEqual(titles(db, "assignee=none&assignee=sato"), ["satoPast", "satoToday"]);
    assert.deepEqual(titles(db, "assignee=none"), []);
  });

  it("今は無い担当者・空・重複は、その分だけ指定なしとして扱う", () => {
    const { db } = setup();
    assert.deepEqual(parseTaskListQuery(qs("assignee=nobody&assignee=&assignee=suzuki&assignee=suzuki"), db).assignees, ["suzuki"]);
    assert.deepEqual(titles(db, "assignee=nobody&assignee=suzuki"), ["suzukiLater", "suzukiWeek"]);
    assert.equal(titles(db, "assignee=nobody").length, 6);
  });
});

describe("GET /api/tasks: 複数のタグ", () => {
  it("tag を 2 つ並べると、両方のタグが付いたタスクだけが返る", () => {
    const { db } = setup();
    assert.deepEqual(titles(db, `tag=${enc("急ぎ")}&tag=${enc("顧客A")}`), ["satoPast", "suzukiWeek", "tanakaPastDone"]);
  });

  it("使われていないタグ・41 文字以上のタグ・空・重複は、その分だけ指定なしとして扱う", () => {
    const { db } = setup();
    const long = "あ".repeat(41);
    const filter = parseTaskListQuery(qs(`tag=${enc("無いタグ")}&tag=${enc(long)}&tag=&tag=${enc(" 急ぎ ")}&tag=${enc("急ぎ")}`), db);
    assert.deepEqual(filter.tags, ["急ぎ"]);
    assert.equal(titles(db, `tag=${enc("無いタグ")}`).length, 6);
  });

  it("6 つ目以降のタグは無視する（画面と同じ最大 5 つ）", () => {
    const { db, ids } = setup();
    const names = ["t1", "t2", "t3", "t4", "t5", "t6"];
    for (const n of names) addTag(ids.tanakaLater, n, db);
    const filter = parseTaskListQuery(qs(names.map((n) => `tag=${n}`).join("&")), db);
    assert.deepEqual(filter.tags, ["t1", "t2", "t3", "t4", "t5"]);
  });
});

describe("GET /api/tasks: 期限", () => {
  it("overdue・today・week・none で、画面の期限の絞り込みと同じタスクが返る", () => {
    const { db } = setup();
    assert.deepEqual(titles(db, "due=overdue"), ["satoPast", "tanakaPastDone"]);
    assert.deepEqual(titles(db, "due=today"), ["satoPast", "satoToday", "tanakaPastDone"]);
    assert.deepEqual(titles(db, "due=week"), ["satoPast", "satoToday", "suzukiWeek", "tanakaPastDone"]);
    assert.deepEqual(titles(db, "due=none"), []);
    for (const due of ["overdue", "today", "week", "none"]) assert.deepEqual(titles(db, `due=${due}`), pageTitles(db, `due=${due}`), due);
  });

  it("「今日」は日本時間で決まる（UTC 15:00 に日付が変わる）", () => {
    const { db } = setup();
    // UTC 11-11 14:59 は日本時間 11-11 23:59。11-12 期限のタスクはまだ「今日まで」に入らない。
    assert.deepEqual(titles(db, "due=today", new Date("2026-11-11T14:59:00Z")), ["satoPast", "tanakaPastDone"]);
    // UTC 11-11 15:00 は日本時間 11-12 0:00。
    assert.deepEqual(titles(db, "due=today", new Date("2026-11-11T15:00:00Z")), ["satoPast", "satoToday", "tanakaPastDone"]);
    assert.deepEqual(titles(db, "due=overdue", new Date("2026-11-12T15:00:00Z")), ["satoPast", "satoToday", "tanakaPastDone"]);
  });

  it("不正な due は指定なしとして扱う", () => {
    const { db } = setup();
    for (const v of ["bogus", "", "OVERDUE", "today "]) {
      assert.equal(parseTaskListQuery(qs(`due=${enc(v)}`), db).due, undefined, v);
      assert.equal(titles(db, `due=${enc(v)}`).length, 6, v);
    }
  });
});

describe("GET /api/tasks: 1 つだけ渡したとき・組み合わせ", () => {
  it("assignee・tag を 1 つだけ渡したときは、これまでと同じ結果", () => {
    const { db } = setup();
    const ids = (s: string) => listTasksByQuery(qs(s), db, NOON_JST).map((t) => t.id);
    assert.deepEqual(ids("assignee=sato"), listTasks({ assignee: "sato" }, db).map((t) => t.id));
    assert.deepEqual(ids(`tag=${enc("急ぎ")}`), listTasks({ tag: "急ぎ" }, db).map((t) => t.id));
  });

  it("担当者・タグ・期限・ステータスを同時に使える", () => {
    const { db } = setup();
    assert.deepEqual(titles(db, `assignee=sato&assignee=tanaka&tag=${enc("顧客A")}&due=overdue`), ["satoPast", "tanakaPastDone"]);
    assert.deepEqual(titles(db, `assignee=sato&assignee=tanaka&tag=${enc("顧客A")}&due=overdue&status=todo`), ["satoPast"]);
  });

  it("アーカイブは archived=include のときだけ、削除したタスクはいつも出ない", () => {
    const { db, ids } = setup();
    updateTask(ids.satoPast, { archived: true }, db);
    db.prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), ids.satoToday);
    assert.deepEqual(titles(db, "assignee=sato&assignee=suzuki&due=week"), ["suzukiWeek"]);
    assert.deepEqual(titles(db, "assignee=sato&assignee=suzuki&due=week&archived=include"), ["satoPast", "suzukiWeek"]);
  });
});

describe("GET /api/tasks: 画面の一覧・CSV と同じ", () => {
  const cases = [
    "assignee=sato&assignee=suzuki",
    "assignee=none&assignee=tanaka&assignee=nobody",
    `tag=${enc("急ぎ")}&tag=${enc("顧客A")}`,
    `tag=${enc("急ぎ")}&tag=${enc("無いタグ")}`,
    "due=week&assignee=suzuki",
    "due=bogus&status=todo",
    `assignee=sato&assignee=tanaka&tag=${enc("顧客A")}&due=overdue&sort=due`,
    "q=sato",
    "",
  ];

  it("同じクエリなら、一覧画面と同じタスクが返る", () => {
    const { db } = setup();
    for (const s of cases) assert.deepEqual(titles(db, s), pageTitles(db, s), s);
  });

  it("同じクエリなら、CSV の書き出しと同じ絞り込みの条件になる（archived を除く）", () => {
    const { db } = setup();
    for (const s of cases) {
      const { includeArchived, ...rest } = parseTaskListQuery(qs(s), db);
      assert.equal(includeArchived, false, s);
      assert.deepEqual(rest, parseTaskFilter(qs(s), db), s);
    }
  });
});
