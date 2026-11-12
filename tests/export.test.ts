import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createTask } from "../src/lib/tasks.ts";
import { addTag } from "../src/lib/tags.ts";
import { CSV_BOM, escapeCsvField, exportFilename, exportHref, exportTasksCsv, neutralizeFormula, parseTaskFilter } from "../src/lib/export.ts";

/** RFC 4180 の CSV を読む（テスト用の最小の実装）。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }
  return rows;
}

const body = (csv: string) => csv.slice(CSV_BOM.length);

describe("escapeCsvField", () => {
  it("leaves plain values and quotes values with a comma, quote or newline", () => {
    assert.equal(escapeCsvField("abc"), "abc");
    assert.equal(escapeCsvField("a,b"), '"a,b"');
    assert.equal(escapeCsvField('a"b'), '"a""b"');
    assert.equal(escapeCsvField("a\nb"), '"a\nb"');
    assert.equal(escapeCsvField("a\r\nb"), '"a\r\nb"');
  });
});

describe("neutralizeFormula", () => {
  it("prefixes a quote when the value starts with = + - @ tab or CR", () => {
    for (const c of ["=", "+", "-", "@", "\t", "\r"]) {
      assert.equal(neutralizeFormula(`${c}x`), `'${c}x`);
    }
  });

  it("leaves other values unchanged", () => {
    assert.equal(neutralizeFormula("請求書 -2 件"), "請求書 -2 件");
    assert.equal(neutralizeFormula("a=b"), "a=b");
    assert.equal(neutralizeFormula(""), "");
  });
});

describe("exportTasksCsv", () => {
  it("starts with a BOM, then a header row, then one row per task", () => {
    const db = openDb();
    const csv = exportTasksCsv({}, db);
    assert.ok(csv.startsWith(CSV_BOM));
    const rows = parseCsv(body(csv));
    assert.deepEqual(rows[0], ["ID", "タイトル", "ステータス", "優先度", "担当者", "期限", "タグ"]);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
    assert.equal(rows.length, count + 1);
    assert.ok(csv.endsWith("\r\n"));
  });

  it("writes status, priority and assignee as the labels shown on screen", () => {
    const db = openDb();
    const task = createTask({ title: "表示名", status: "in_progress", assignee: "sato", dueDate: "2026-12-01", priority: "high" }, db);
    const row = parseCsv(body(exportTasksCsv({}, db))).find((r) => r[0] === String(task.id))!;
    assert.deepEqual(row, [String(task.id), "表示名", "進行中", "高", "佐藤", "2026-12-01", ""]);
  });

  it("reads back a title with a comma, double quote and newline unchanged", () => {
    const db = openDb();
    const title = 'a,b "c"\nd';
    const task = createTask({ title, status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    const row = parseCsv(body(exportTasksCsv({}, db))).find((r) => r[0] === String(task.id))!;
    assert.equal(row[1], title);
    assert.equal(row.length, 7);
  });

  it("neutralizes a formula in the title and keeps RFC 4180 escaping", () => {
    const db = openDb();
    const title = '=HYPERLINK("http://example.com","x")';
    const task = createTask({ title, status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    const csv = exportTasksCsv({}, db);
    assert.ok(csv.includes(`"'=HYPERLINK(""http://example.com"",""x"")"`));
    const row = parseCsv(body(csv)).find((r) => r[0] === String(task.id))!;
    assert.equal(row[1], `'${title}`);
  });

  it("leaves a title that does not start with a trigger character, and app-made fields, unchanged", () => {
    const db = openDb();
    const task = createTask({ title: "請求書 -2 件", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    const row = parseCsv(body(exportTasksCsv({}, db))).find((r) => r[0] === String(task.id))!;
    assert.deepEqual(row, [String(task.id), "請求書 -2 件", "未着手", "中", "佐藤", "2026-12-01", ""]);
  });

  it("neutralizes a formula in the tags column", () => {
    const db = openDb();
    const task = createTask({ title: "t", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    addTag(task.id, "=cmd", db);
    addTag(task.id, "ok", db);
    const row = parseCsv(body(exportTasksCsv({}, db))).find((r) => r[0] === String(task.id))!;
    assert.equal(row[6], "'=cmd、ok");
  });

  it("joins several tags with 、", () => {
    const db = openDb();
    const task = createTask({ title: "タグ", status: "todo", assignee: "sato", dueDate: "2026-12-01" }, db);
    addTag(task.id, "a", db);
    addTag(task.id, "b", db);
    const row = parseCsv(body(exportTasksCsv({}, db))).find((r) => r[0] === String(task.id))!;
    assert.equal(row[6], "a、b");
  });

  it("applies the same filter as the list screen", () => {
    const db = openDb();
    const csv = exportTasksCsv({ status: "done" }, db);
    const rows = parseCsv(body(csv)).slice(1);
    const done = (db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'done'").get() as { n: number }).n;
    assert.ok(done > 0);
    assert.equal(rows.length, done);
    assert.ok(rows.every((r) => r[2] === "完了"));
  });
});

describe("parseTaskFilter", () => {
  it("treats invalid values as not specified", () => {
    const db = openDb();
    const filter = parseTaskFilter(new URLSearchParams("status=bogus&assignee=nobody&tag=%20&sort=zzz"), db);
    assert.deepEqual(filter, { status: undefined, assignee: undefined, tag: undefined, sort: "created" });
  });

  it("accepts valid values", () => {
    const db = openDb();
    const filter = parseTaskFilter(new URLSearchParams("status=done&assignee=none&tag=x&sort=priority"), db);
    assert.deepEqual(filter, { status: "done", assignee: "none", tag: "x", sort: "priority" });
  });
});

describe("exportHref", () => {
  it("carries the open filter and sort to the download link", () => {
    assert.equal(exportHref({}), "/api/tasks/export");
    assert.equal(exportHref({ status: "todo", sort: "created" }), "/api/tasks/export?status=todo");
    assert.equal(
      exportHref({ status: "done", assignee: "sato", tag: "急ぎ", sort: "priority" }),
      "/api/tasks/export?status=done&assignee=sato&tag=%E6%80%A5%E3%81%8E&sort=priority",
    );
  });
});

describe("exportFilename", () => {
  it("uses the Japan date", () => {
    assert.equal(exportFilename(new Date("2026-11-12T15:00:00Z")), "tasks-2026-11-13.csv");
    assert.equal(exportFilename(new Date("2026-11-12T14:59:00Z")), "tasks-2026-11-12.csv");
  });
});
