import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { listTasksByQuery } from "../src/lib/task-query.ts";
import { createTask, parseSort, SORT_LABELS, TASK_SORTS } from "../src/lib/tasks.ts";
import type { TaskPriority, TaskStatus } from "../src/lib/tasks.ts";

const q = (s: string) => new URLSearchParams(s);
const make = (db: ReturnType<typeof openDb>, title: string, dueDate: string, status: TaskStatus = "todo", priority: TaskPriority = "medium", assignee = "sato") =>
  createTask({ title, status, assignee, dueDate, priority, archived: false }, db).id;

describe("sort=due", () => {
  it("並び順の選択肢に「期限の近い順」があり、sort=due を受け付ける", () => {
    assert.ok(TASK_SORTS.includes("due"));
    assert.equal(SORT_LABELS.due, "期限の近い順");
    assert.equal(parseSort("due"), "due");
  });

  it("期限の早い順に並ぶ", () => {
    const db = openDb();
    const dates = listTasksByQuery(q("sort=due"), db).filter((t) => t.status !== "done").map((t) => t.dueDate);
    assert.deepEqual(dates, [...dates].sort());
  });

  it("完了したタスクは、期限が早くても未完了より後に並ぶ（完了どうしは期限順）", () => {
    const db = openDb();
    const doneEarly = make(db, "完了・早い", "2000-01-01", "done");
    const doneEarlier = make(db, "完了・もっと早い", "1999-01-01", "done");
    const openLate = make(db, "未完了・遅い", "2999-12-31");
    const ids = listTasksByQuery(q("sort=due"), db).map((t) => t.id);
    assert.ok(ids.indexOf(openLate) < ids.indexOf(doneEarlier));
    assert.ok(ids.indexOf(doneEarlier) < ids.indexOf(doneEarly));
    const tasks = listTasksByQuery(q("sort=due"), db);
    const firstDone = tasks.findIndex((t) => t.status === "done");
    assert.ok(tasks.slice(firstDone).every((t) => t.status === "done"));
  });

  it("期限が同じ未完了のタスクは優先度の高い順、それも同じなら作成の古い順", () => {
    const db = openDb();
    const low = make(db, "低", "2500-01-01", "todo", "low");
    const high = make(db, "高", "2500-01-01", "todo", "high");
    const med1 = make(db, "中1", "2500-01-01", "todo", "medium");
    const med2 = make(db, "中2", "2500-01-01", "in_progress", "medium");
    const ids = listTasksByQuery(q("sort=due"), db).map((t) => t.id);
    const at = ids.indexOf(high);
    assert.deepEqual(ids.slice(at, at + 4), [high, med1, med2, low]);
  });

  it("ほかの絞り込みと組み合わせられる", () => {
    const db = openDb();
    const a = make(db, "田中", "2400-01-01", "todo", "medium", "tanaka");
    const b = make(db, "田中・早い", "2300-01-01", "todo", "medium", "tanaka");
    const tasks = listTasksByQuery(q("assignee=tanaka&status=todo&sort=due"), db);
    assert.ok(tasks.every((t) => t.assignee === "tanaka" && t.status === "todo"));
    const ids = tasks.map((t) => t.id);
    assert.ok(ids.indexOf(b) < ids.indexOf(a));
  });
});
