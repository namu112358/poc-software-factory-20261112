import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { listTasksByQuery } from "../src/lib/task-query.ts";
import { updateTask } from "../src/lib/tasks.ts";

const q = (s: string) => new URLSearchParams(s);

describe("listTasksByQuery", () => {
  it("assignee=<ID> returns only that person's tasks", () => {
    const db = openDb();
    const tasks = listTasksByQuery(q("assignee=sato"), db);
    assert.ok(tasks.length > 0);
    assert.ok(tasks.every((t) => t.assignee === "sato"));
  });

  it("assignee=none returns no assigned task (assignee is NOT NULL, so no task is unassigned today)", () => {
    const db = openDb();
    assert.deepEqual(listTasksByQuery(q("assignee=none"), db), []);
  });

  it("sort=priority orders high to low; no sort keeps id order", () => {
    const db = openDb();
    const rank = { high: 0, medium: 1, low: 2 };
    const sorted = listTasksByQuery(q("sort=priority"), db).map((t) => rank[t.priority]);
    assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b));
    const plain = listTasksByQuery(q(""), db).map((t) => t.id);
    assert.deepEqual(plain, [...plain].sort((a, b) => a - b));
    assert.deepEqual(listTasksByQuery(q("sort=bogus"), db).map((t) => t.id), plain);
  });

  it("unknown assignee and invalid sort are treated as unspecified", () => {
    const db = openDb();
    const all = listTasksByQuery(q(""), db).map((t) => t.id);
    assert.deepEqual(listTasksByQuery(q("assignee=nobody&sort=xyz"), db).map((t) => t.id), all);
  });

  it("combines with status and tag", () => {
    const db = openDb();
    const tasks = listTasksByQuery(q("assignee=sato&status=todo&sort=priority"), db);
    assert.ok(tasks.every((t) => t.assignee === "sato" && t.status === "todo"));
    const expected = listTasksByQuery(q("status=todo"), db).filter((t) => t.assignee === "sato").length;
    assert.equal(tasks.length, expected);
    assert.deepEqual(listTasksByQuery(q("status=bogus"), db).map((t) => t.id), listTasksByQuery(q(""), db).map((t) => t.id));
  });
});

describe("listTasksByQuery: q（キーワード）", () => {
  const add = (db: ReturnType<typeof openDb>, title: string, memo = "", assignee = "sato", status = "todo") =>
    Number(
      db
        .prepare(
          "INSERT INTO tasks (title, status, assignee, due_date, priority, memo, created_at, updated_at) VALUES (?, ?, ?, '2026-12-01', 'medium', ?, 'x', 'x')",
        )
        .run(title, status, assignee, memo).lastInsertRowid,
    );
  const ids = (db: ReturnType<typeof openDb>, s: string) => listTasksByQuery(q(s), db).map((t) => t.id);

  it("returns only tasks whose title contains the keyword", () => {
    const db = openDb();
    const a = add(db, "請求書を送る");
    add(db, "会議の準備");
    assert.deepEqual(ids(db, "q=" + encodeURIComponent("請求")), [a]);
  });

  it("matches the memo too", () => {
    const db = openDb();
    const a = add(db, "無関係なタイトル", "請求の確認");
    assert.deepEqual(ids(db, "q=" + encodeURIComponent("請求")), [a]);
  });

  it("is case-insensitive for ASCII letters", () => {
    const db = openDb();
    const a = add(db, "api の設計");
    assert.ok(ids(db, "q=API").includes(a));
  });

  it("distinguishes full-width from half-width", () => {
    const db = openDb();
    add(db, "ＡＰＩ の設計");
    assert.equal(ids(db, "q=" + encodeURIComponent("zzAPI")).length, 0);
    const full = add(db, "ＸＹＺ のメモ");
    assert.deepEqual(ids(db, "q=XYZ"), []);
    assert.deepEqual(ids(db, "q=" + encodeURIComponent("ＸＹＺ")), [full]);
  });

  it("empty or whitespace-only q does not filter; surrounding spaces are trimmed", () => {
    const db = openDb();
    const a = add(db, "請求書");
    const all = ids(db, "");
    assert.ok(all.includes(a));
    assert.deepEqual(ids(db, "q="), all);
    assert.deepEqual(ids(db, "q=" + encodeURIComponent("  　 ")), all);
    assert.deepEqual(ids(db, "q=" + encodeURIComponent(" 請求 ")), [a]);
  });

  it("treats % _ and \\ as literal characters", () => {
    const db = openDb();
    const pct = add(db, "達成率 100% の確認");
    const und = add(db, "file_name を直す");
    const bs = add(db, "パス C:\\temp");
    add(db, "100 件の確認");
    add(db, "fileXname");
    assert.deepEqual(ids(db, "q=" + encodeURIComponent("%")), [pct]);
    assert.deepEqual(ids(db, "q=" + encodeURIComponent("_")), [und]);
    assert.deepEqual(ids(db, "q=" + encodeURIComponent("file_n")), [und]);
    assert.deepEqual(ids(db, "q=" + encodeURIComponent("\\")), [bs]);
  });

  it("combines with status, assignee and tag", () => {
    const db = openDb();
    const a = add(db, "請求書 A", "", "sato", "todo");
    add(db, "請求書 B", "", "suzuki", "todo");
    add(db, "請求書 C", "", "sato", "done");
    const k = encodeURIComponent("請求");
    assert.deepEqual(ids(db, `q=${k}&status=todo&assignee=sato`), [a]);
    db.prepare("INSERT INTO task_tags (task_id, name) VALUES (?, 'Bug')").run(a);
    assert.deepEqual(ids(db, `q=${k}&tag=Bug`), [a]);
  });
});

describe("archived クエリ", () => {
  it("指定なしのとき、アーカイブしたタスクは出ない", () => {
    const db = openDb();
    updateTask(4, { archived: true }, db);
    assert.ok(!listTasksByQuery(q(""), db).some((t) => t.id === 4));
  });

  it("archived=include のとき、アーカイブしたタスクも出る", () => {
    const db = openDb();
    updateTask(4, { archived: true }, db);
    const t = listTasksByQuery(q("archived=include"), db).find((x) => x.id === 4);
    assert.ok(t);
    assert.equal(t.archived, true);
  });

  it("include 以外の値は指定なしとして扱う", () => {
    const db = openDb();
    updateTask(4, { archived: true }, db);
    for (const v of ["true", "1", "INCLUDE", "", "exclude"]) {
      assert.ok(!listTasksByQuery(q(`archived=${v}`), db).some((t) => t.id === 4), v);
    }
  });
});
