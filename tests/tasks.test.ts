import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, openDb } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import {
  assigneeName,
  createTask,
  isOverdue,
  taskRowDoneAttr,
  priorityFontWeight,
  todayInJapan,
  formatEstimate,
  formatEstimateTotal,
  sumEstimateMinutes,
  formatJstDateTime,
  formatMemoPreview,
  memoTooltip,
  formatTaskNumber,
  formatTaskCount,
  TASK_LIST_HELP,
  getTask,
  isTaskStatus,
  listAssignees,
  listTasks,
  parseSort,
  parseAssignee,
  parseTaskId,
  updateTask,
  validateTaskInput,
} from "../src/lib/tasks.ts";

describe("listTasks", () => {
  it("returns all tasks without a filter", () => {
    assert.equal(listTasks({}, openDb()).length, 7);
  });

  it("filters by status", () => {
    const tasks = listTasks({ status: "todo" }, openDb());
    assert.ok(tasks.length > 0);
    assert.ok(tasks.every((t) => t.status === "todo"));
  });
});

describe("listTasks by assignee", () => {
  it("filters by assignee", () => {
    const tasks = listTasks({ assignee: "sato" }, openDb());
    assert.equal(tasks.length, 3);
    assert.ok(tasks.every((t) => t.assignee === "sato"));
  });

  it("combines status and assignee", () => {
    const tasks = listTasks({ status: "todo", assignee: "sato" }, openDb());
    assert.deepEqual(
      tasks.map((t) => t.title),
      ["E2E テストの追加"],
    );
  });
});

describe("listAssignees", () => {
  it("returns assignees appearing in tasks without duplicates", () => {
    assert.deepEqual(
      listAssignees(openDb()).map((a) => a.id),
      ["sato", "suzuki", "tanaka"],
    );
  });

  it("excludes users with no tasks", () => {
    const db = openDb();
    db.prepare("INSERT INTO users (id, name, password_hash) VALUES ('new', '新人', 'x')").run();
    assert.ok(!listAssignees(db).some((a) => a.id === "new"));
  });
});

describe("assigneeName", () => {
  it("ログイン ID ではなく、担当者の名前を返す", () => {
    const db = openDb();
    const assignees = listAssignees(db);
    const task = listTasks({}, db)[0];
    const name = assigneeName(task.assignee, assignees);
    assert.notEqual(name, task.assignee);
    assert.equal(name, assignees.find((a) => a.id === task.assignee)?.name);
  });

  it("担当者の絞り込みの値はログイン ID のまま", () => {
    assert.deepEqual(
      listAssignees(openDb()).map((a) => a.id),
      ["sato", "suzuki", "tanaka"],
    );
  });

  it("担当者なしは空文字を返す", () => {
    assert.equal(assigneeName(null, listAssignees(openDb())), "");
  });
});

describe("担当者なしの絞り込み", () => {
  it("parseAssignee は none を受け付ける", () => {
    assert.equal(parseAssignee("none", openDb()), "none");
  });

  it("担当者が決まっていないタスクが無ければ 0 件になる", () => {
    assert.equal(listTasks({ assignee: "none" }, openDb()).length, 0);
  });

  it("担当者が決まっていないタスクだけを返し、ステータスと併用できる", () => {
    const db = openDb();
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("CREATE TABLE tasks_bak AS SELECT * FROM tasks");
    db.exec("DROP TABLE tasks");
    db.exec(
      "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL, assignee TEXT, due_date TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium', estimate_minutes INTEGER, memo TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')",
    );
    db.exec("INSERT INTO tasks SELECT * FROM tasks_bak");
    db.exec("INSERT INTO tasks (title, status, assignee, due_date) VALUES ('未割当', 'todo', NULL, '2026-12-01')");
    db.exec("INSERT INTO tasks (title, status, assignee, due_date) VALUES ('未割当完了', 'done', NULL, '2026-12-01')");
    const none = listTasks({ assignee: "none" }, db);
    assert.deepEqual(none.map((t) => t.title), ["未割当", "未割当完了"]);
    assert.deepEqual(listTasks({ assignee: "none", status: "todo" }, db).map((t) => t.title), ["未割当"]);
  });
});

describe("parseAssignee", () => {
  it("accepts a known assignee and treats unknown values as unspecified", () => {
    const db = openDb();
    assert.equal(parseAssignee("sato", db), "sato");
    assert.equal(parseAssignee("nobody", db), undefined);
    assert.equal(parseAssignee(undefined, db), undefined);
    assert.equal(parseAssignee(["sato"], db), undefined);
  });
});

describe("getTask", () => {
  it("returns a task by id, or undefined", () => {
    const db = openDb();
    const task = getTask(1, db);
    assert.deepEqual({ ...task, createdAt: "", updatedAt: "" }, {
      id: 1,
      createdAt: "",
      updatedAt: "",
      title: "要件定義書のレビュー",
      status: "done",
      assignee: "sato",
      estimateMinutes: null,
      memo: "",
      dueDate: "2026-11-02",
      priority: "medium",
    });
    assert.equal(getTask(999, db), undefined);
  });
});

describe("parseTaskId", () => {
  it("accepts positive integers only", () => {
    assert.equal(parseTaskId("3"), 3);
    for (const bad of ["0", "-1", "1.5", "abc", "", "01", undefined]) assert.equal(parseTaskId(bad), undefined, String(bad));
  });
});

describe("validateTaskInput", () => {
  const valid = { title: " 新しいタスク ", status: "todo", assignee: "tanaka", dueDate: "2026-12-01" };

  it("accepts a complete input and trims the title", () => {
    const r = validateTaskInput(valid, {}, openDb());
    assert.deepEqual(r, { ok: true, value: { ...valid, title: "新しいタスク" } });
  });

  it("reports every invalid field", () => {
    const r = validateTaskInput({ title: "", status: "x", assignee: "nobody", dueDate: "12/01" }, {}, openDb());
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.errors.length, 4);
  });

  it("accepts high / medium / low priority and rejects other values", () => {
    for (const priority of ["high", "medium", "low"]) {
      assert.deepEqual(validateTaskInput({ ...valid, priority }, {}, openDb()), {
        ok: true,
        value: { ...valid, title: "新しいタスク", priority },
      });
    }
    for (const priority of ["urgent", "", null, 1]) {
      const r = validateTaskInput({ ...valid, priority }, {}, openDb());
      assert.equal(r.ok, false, String(priority));
    }
    assert.equal(validateTaskInput({ priority: "x" }, { partial: true }, openDb()).ok, false);
    assert.deepEqual(validateTaskInput({ priority: "low" }, { partial: true }, openDb()), {
      ok: true,
      value: { priority: "low" },
    });
  });

  it("rejects non-object bodies", () => {
    for (const body of [undefined, null, "x", []]) assert.equal(validateTaskInput(body, {}, openDb()).ok, false);
  });

  it("validates only the given fields when partial", () => {
    assert.deepEqual(validateTaskInput({ status: "done" }, { partial: true }, openDb()), {
      ok: true,
      value: { status: "done" },
    });
    assert.equal(validateTaskInput({ status: "x" }, { partial: true }, openDb()).ok, false);
  });
});

describe("createTask / updateTask", () => {
  it("creates a task and updates only the given fields", () => {
    const db = openDb();
    const created = createTask({ title: "新規", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    assert.equal(created.id, 8);
    assert.equal(listTasks({}, db).length, 8);
    const updated = updateTask(created.id, { status: "done" }, db);
    assert.deepEqual(updated, { ...created, status: "done", updatedAt: updated!.updatedAt });
    assert.equal(updateTask(999, { status: "done" }, db), undefined);
  });
});

describe("priority", () => {
  it("defaults to medium for existing and new tasks, and can be set and updated", () => {
    const db = openDb();
    assert.ok(listTasks({}, db).every((t) => t.priority === "medium"));
    const defaulted = createTask({ title: "既定", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    assert.equal(defaulted.priority, "medium");
    const high = createTask({ title: "高", status: "todo", assignee: "sato", dueDate: "2026-12-01", priority: "high" }, db);
    assert.equal(getTask(high.id, db)!.priority, "high");
    assert.equal(updateTask(high.id, { priority: "low" }, db)!.priority, "low");
    assert.equal(updateTask(high.id, { status: "done" }, db)!.priority, "low");
  });
});

describe("isTaskStatus", () => {
  it("accepts known statuses only", () => {
    assert.equal(isTaskStatus("done"), true);
    assert.equal(isTaskStatus("unknown"), false);
    assert.equal(isTaskStatus(undefined), false);
  });
});

describe("formatTaskCount", () => {
  it("shows the number of all tasks as 「N 件」", () => {
    const db = openDb();
    assert.equal(formatTaskCount(listTasks({}, db).length), "7 件");
  });

  it("shows the count after filtering by status", () => {
    const db = openDb();
    const todo = listTasks({ status: "todo" }, db);
    assert.equal(formatTaskCount(todo.length), "3 件");
  });

  it("shows 「0 件」 when nothing matches", () => {
    assert.equal(formatTaskCount(0), "0 件");
  });
});

describe("isOverdue", () => {
  const today = "2026-11-12";
  it("期限日の翌日以降の未完了タスクは期限切れ", () => {
    assert.equal(isOverdue({ status: "todo", dueDate: "2026-11-11" }, today), true);
    assert.equal(isOverdue({ status: "in_progress", dueDate: "2026-01-01" }, today), true);
  });
  it("期限当日と期限前は期限切れではない", () => {
    assert.equal(isOverdue({ status: "todo", dueDate: today }, today), false);
    assert.equal(isOverdue({ status: "todo", dueDate: "2026-11-13" }, today), false);
  });
  it("完了したタスクは期限を過ぎても期限切れではない", () => {
    assert.equal(isOverdue({ status: "done", dueDate: "2026-11-01" }, today), false);
  });
  it("「今日」は日本時間で判断する", () => {
    assert.equal(todayInJapan(new Date("2026-11-11T15:00:00Z")), "2026-11-12");
    assert.equal(todayInJapan(new Date("2026-11-11T14:59:59Z")), "2026-11-11");
  });
});

describe("sort by priority", () => {
  const mk = (db: ReturnType<typeof openDb>, title: string, priority: "high" | "medium" | "low", assignee = "sato") =>
    createTask({ title, status: "todo", assignee, dueDate: "2026-12-01", priority }, db);

  it("orders high → medium → low, and by creation order within the same priority", () => {
    const db = openDb();
    const l1 = mk(db, "低1", "low");
    const h1 = mk(db, "高1", "high");
    const m1 = mk(db, "中1", "medium");
    const h2 = mk(db, "高2", "high");
    const ids = listTasks({ sort: "priority" }, db).map((t) => t.id);
    const ps = listTasks({ sort: "priority" }, db).map((t) => t.priority);
    const rank = { high: 0, medium: 1, low: 2 };
    assert.deepEqual(ps, [...ps].sort((a, b) => rank[a] - rank[b]));
    assert.ok(ids.indexOf(h1.id) < ids.indexOf(h2.id));
    assert.ok(ids.indexOf(h2.id) < ids.indexOf(m1.id));
    assert.ok(ids.indexOf(m1.id) < ids.indexOf(l1.id));
  });

  it("keeps creation order by default", () => {
    const db = openDb();
    mk(db, "低", "low");
    mk(db, "高", "high");
    const ids = listTasks({}, db).map((t) => t.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    assert.deepEqual(listTasks({ sort: "created" }, db).map((t) => t.id), ids);
  });

  it("works together with the status filter", () => {
    const db = openDb();
    const done = createTask({ title: "完了の低", status: "done", assignee: "sato", dueDate: "2026-12-01", priority: "low" }, db);
    createTask({ title: "完了の高", status: "done", assignee: "sato", dueDate: "2026-12-01", priority: "high" }, db);
    const r = listTasks({ status: "done", sort: "priority" }, db);
    assert.ok(r.every((t) => t.status === "done"));
    assert.equal(r[0].priority, "high");
    assert.equal(r[r.length - 1].id, done.id);
  });

  it("treats invalid sort values as creation order", () => {
    assert.equal(parseSort("priority"), "priority");
    for (const v of [undefined, "", "bogus", "PRIORITY", ["priority"], 1]) assert.equal(parseSort(v), "created");
  });
});

describe("estimateMinutes", () => {
  const base = { title: "t", status: "todo", assignee: "sato", dueDate: "2026-12-01" };

  it("is null for seeded tasks and tasks created without it", () => {
    const db = openDb();
    assert.ok(listTasks({}, db).every((t) => t.estimateMinutes === null));
    const task = createTask({ ...base, status: "todo" }, db);
    assert.equal(task.estimateMinutes, null);
  });

  it("can be set on create, updated, and reset to null", () => {
    const db = openDb();
    const task = createTask({ ...base, status: "todo", estimateMinutes: 90 }, db);
    assert.equal(getTask(task.id, db)?.estimateMinutes, 90);
    assert.equal(updateTask(task.id, { estimateMinutes: 120 }, db)?.estimateMinutes, 120);
    assert.equal(updateTask(task.id, { title: "x" }, db)?.estimateMinutes, 120);
    assert.equal(updateTask(task.id, { estimateMinutes: null }, db)?.estimateMinutes, null);
  });

  it("validates range and integer-ness", () => {
    const db = openDb();
    const check = (v: unknown) => validateTaskInput({ estimateMinutes: v }, { partial: true }, db).ok;
    assert.equal(check(1), true);
    assert.equal(check(10000), true);
    assert.equal(check(null), true);
    for (const bad of [0, 10001, -5, 1.5, "90", NaN, true]) assert.equal(check(bad), false, String(bad));
    const r = validateTaskInput({ estimateMinutes: 0 }, { partial: true }, db);
    assert.ok(!r.ok && r.errors.length > 0);
  });

  it("formats for display", () => {
    assert.equal(formatEstimate(90), "90 分");
    assert.equal(formatEstimate(null), "—");
  });
});

describe("タスクの番号", () => {
  it("formats as #<ID>", () => {
    assert.equal(formatTaskNumber(3), "#3");
    assert.equal(formatTaskNumber(120), "#120");
  });
});

describe("作成日時・更新日時", () => {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const base = { title: "新規", status: "todo", assignee: "sato", dueDate: "2026-12-01" } as const;

  it("作成すると、作成日時と更新日時が ISO 8601（UTC）で入る", () => {
    const db = openDb();
    const task = createTask(base, db);
    assert.match(task.createdAt, ISO);
    assert.equal(task.updatedAt, task.createdAt);
    assert.equal(getTask(task.id, db)?.createdAt, task.createdAt);
  });

  it("更新すると更新日時だけが変わる", () => {
    const db = openDb();
    const task = createTask(base, db);
    db.prepare("UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", task.id);
    const updated = updateTask(task.id, { status: "done" }, db)!;
    assert.equal(updated.createdAt, "2026-01-01T00:00:00.000Z");
    assert.notEqual(updated.updatedAt, "2026-01-01T00:00:00.000Z");
    assert.match(updated.updatedAt, ISO);
  });

  it("既存のタスクには、マイグレーションを入れた時点の日時が入る", () => {
    const old = new DatabaseSync(":memory:");
    migrate(old, MIGRATIONS.filter((m) => m.version < 10));
    old.exec("INSERT INTO users (id, name) VALUES ('u', 'U')");
    old.exec("INSERT INTO tasks (title, status, assignee, due_date) VALUES ('既存', 'todo', 'u', '2026-01-01')");
    const t0 = Date.now();
    migrate(old);
    const task = getTask(1, old)!;
    assert.match(task.createdAt, ISO);
    assert.equal(task.updatedAt, task.createdAt);
    assert.ok(Date.parse(task.createdAt) >= t0 - 1000);
  });
});

describe("formatJstDateTime", () => {
  it("UTC の日時を日本時間の YYYY/MM/DD HH:mm にする", () => {
    assert.equal(formatJstDateTime("2026-11-12T06:04:00.000Z"), "2026/11/12 15:04");
    assert.equal(formatJstDateTime("2026-11-12T16:30:00.000Z"), "2026/11/13 01:30");
    assert.equal(formatJstDateTime("2026-11-12T15:30:00.000Z"), "2026/11/13 00:30");
  });
  it("解釈できない値は「—」にする", () => {
    assert.equal(formatJstDateTime(""), "—");
  });
});

describe("duplicateTask", () => {
  it("copies title, assignee, due date, priority, estimate and tags, with status todo and no comments", async () => {
    const { duplicateTask, getTask } = await import("../src/lib/tasks.ts");
    const { addTag, listTags } = await import("../src/lib/tags.ts");
    const db = openDb();
    db.prepare("UPDATE tasks SET status = 'done', priority = 'high', estimate_minutes = 90 WHERE id = 1").run();
    addTag(1, "急ぎ", db);
    addTag(1, "週次", db);
    db.prepare("INSERT INTO comments (task_id, author, body, created_at) VALUES (1, 'sato', 'メモ', '2026-01-01 00:00:00')").run();
    const source = getTask(1, db)!;
    const copy = duplicateTask(1, db)!;
    assert.notEqual(copy.id, 1);
    assert.equal(copy.status, "todo");
    assert.equal(copy.title, source.title);
    assert.equal(copy.assignee, source.assignee);
    assert.equal(copy.dueDate, source.dueDate);
    assert.equal(copy.priority, "high");
    assert.equal(copy.estimateMinutes, 90);
    assert.deepEqual(listTags(copy.id, db), ["急ぎ", "週次"]);
    const n = db.prepare("SELECT COUNT(*) AS n FROM comments WHERE task_id = ?").get(copy.id) as { n: number };
    assert.equal(n.n, 0);
    assert.equal(getTask(1, db)!.status, "done");
  });

  it("returns undefined for a missing task", async () => {
    const { duplicateTask } = await import("../src/lib/tasks.ts");
    assert.equal(duplicateTask(9999, openDb()), undefined);
  });
});

describe("memo", () => {
  const base = { title: "t", status: "todo", assignee: "sato", dueDate: "2026-12-01" } as const;

  it("is empty for seeded tasks and tasks created without it", () => {
    const db = openDb();
    assert.ok(listTasks({}, db).every((t) => t.memo === ""));
    assert.equal(createTask({ ...base }, db).memo, "");
  });

  it("can be set on create and updated without touching other fields", () => {
    const db = openDb();
    const task = createTask({ ...base, memo: "1 行目\n2 行目" }, db);
    assert.equal(getTask(task.id, db)?.memo, "1 行目\n2 行目");
    assert.equal(updateTask(task.id, { memo: "変更後" }, db)?.memo, "変更後");
    assert.equal(updateTask(task.id, { title: "x" }, db)?.memo, "変更後");
    assert.equal(updateTask(task.id, { memo: "" }, db)?.memo, "");
  });

  it("validates type and length (0〜2000 characters)", () => {
    const db = openDb();
    const check = (v: unknown) => validateTaskInput({ memo: v }, { partial: true }, db).ok;
    assert.equal(check(""), true);
    assert.equal(check("あ".repeat(2000)), true);
    for (const bad of ["あ".repeat(2001), 1, null, true, ["a"]]) assert.equal(check(bad), false, String(bad));
    const r = validateTaskInput({ memo: "a".repeat(2001) }, { partial: true }, db);
    assert.ok(!r.ok && r.errors.length > 0);
  });

  it("is optional on create", () => {
    const db = openDb();
    assert.equal(validateTaskInput({ ...base }, {}, db).ok, true);
  });
});

describe("formatMemoPreview", () => {
  it("空のメモは表示しない", () => {
    assert.equal(formatMemoPreview(""), null);
  });
  it("30 文字以内はそのまま、超えたら 30 文字の後に「…」を付ける", () => {
    const m30 = "あ".repeat(30);
    assert.equal(formatMemoPreview(m30), m30);
    assert.equal(formatMemoPreview(m30 + "い"), m30 + "…");
  });
  it("改行は空白 1 つに置き換える", () => {
    assert.equal(formatMemoPreview("a\nb\r\nc"), "a b c");
  });
});

describe("memoTooltip", () => {
  it("メモの全文をそのまま返す（長くても省略しない・改行も残す）", () => {
    const long = "あ".repeat(100) + "\n続き";
    assert.equal(memoTooltip(long), long);
  });
  it("空のメモには付けない", () => {
    assert.equal(memoTooltip(""), undefined);
  });
});

describe("TASK_LIST_HELP", () => {
  it("使い方の説明が指定の文言である", () => {
    assert.equal(TASK_LIST_HELP, "ステータス・担当者・タグで絞り込み、優先度の高い順に並べ替えられます。");
  });
});

describe("見積もり時間の合計", () => {
  it("未設定のタスクは数えない", () => {
    assert.equal(sumEstimateMinutes([{ estimateMinutes: 90 }, { estimateMinutes: null }, { estimateMinutes: 300 }]), 390);
    assert.equal(sumEstimateMinutes([]), 0);
  });

  it("60 分未満は「M 分」、それ以上は「H 時間 M 分」で表示する", () => {
    assert.equal(formatEstimateTotal(0), "0 分");
    assert.equal(formatEstimateTotal(59), "59 分");
    assert.equal(formatEstimateTotal(60), "1 時間 0 分");
    assert.equal(formatEstimateTotal(390), "6 時間 30 分");
  });

  it("絞り込んだ後のタスクの合計になる", () => {
    const db = openDb();
    const all = sumEstimateMinutes(listTasks({}, db));
    const todo = sumEstimateMinutes(listTasks({ status: "todo" }, db));
    assert.ok(todo <= all);
    assert.equal(todo, listTasks({ status: "todo" }, db).reduce((s, t) => s + (t.estimateMinutes ?? 0), 0));
  });
});

describe("taskRowDoneAttr", () => {
  it("完了したタスクだけ data-done を付ける", () => {
    assert.deepEqual(taskRowDoneAttr("done"), { "data-done": "true" });
    assert.deepEqual(taskRowDoneAttr("todo"), {});
    assert.deepEqual(taskRowDoneAttr("in_progress"), {});
  });
});

describe("priorityFontWeight", () => {
  it("優先度が「高」のときだけ太字にする", () => {
    assert.equal(priorityFontWeight("high"), "bold");
    assert.equal(priorityFontWeight("medium"), undefined);
    assert.equal(priorityFontWeight("low"), undefined);
  });
});
