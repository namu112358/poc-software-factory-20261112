// 担当のタスクが無い利用者（担当をすべて引き継いだあとのメンバーなど）で絞り込むと、
// 一覧の画面・CSV・API のどれも 0 件になる。絞り込みが外れて全件が出ない（#436）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { updateTasks } from "../src/lib/bulk-update.ts";
import { exportTasksCsv, parseTaskFilter } from "../src/lib/export.ts";
import { listTasksByQuery } from "../src/lib/task-query.ts";
import { buildAssigneeFilterOptions, filterConditionsFromForm } from "../src/lib/task-filter-form.ts";
import { loadTaskViewPrefs, resolveTaskViewQuery, saveTaskViewPrefs } from "../src/lib/task-view-prefs.ts";
import { deleteTask, listAssignees, listTasks, parseAssignee, parseAssignees, updateTask } from "../src/lib/tasks.ts";
import { listAssigneeOptions } from "../src/lib/members.ts";

type Db = ReturnType<typeof openDb>;

/** 鈴木の担当のタスクを、まとめて佐藤へ替える（Issue の再現手順と同じ操作）。 */
function handOverSuzuki(): Db {
  const db = openDb();
  const ids = listTasks({ assignees: ["suzuki"] }, db).map((t) => t.id);
  assert.ok(ids.length > 0);
  updateTasks(ids, { assignee: "sato" }, db);
  assert.equal(listTasks({ assignees: ["suzuki"] }, db).length, 0);
  return db;
}

const qs = (s: string) => new URLSearchParams(s);
/** CSV のデータの行数（見出しの行を除く）。 */
const csvRows = (csv: string) => csv.split("\r\n").filter((l) => l !== "").length - 1;
/** 一覧の画面と同じ組み立て（parseAssignees を通して listTasks に渡す）。 */
const pageTasks = (db: Db, assignee: string | string[]) => listTasks({ assignees: parseAssignees(assignee, db), qInComments: true }, db);

describe("担当のタスクが無い利用者で絞り込む", () => {
  it("担当をすべて替えたあとの鈴木で絞り込むと、一覧の画面・CSV・API のどれも 0 件（全件を返さない）", () => {
    const db = handOverSuzuki();
    assert.ok(listTasks({}, db).length > 0);
    assert.equal(pageTasks(db, "suzuki").length, 0);
    assert.equal(listTasksByQuery(qs("assignee=suzuki"), db).length, 0);
    assert.equal(csvRows(exportTasksCsv(parseTaskFilter(qs("assignee=suzuki"), db), db)), 0);
  });

  it("タスクを 1 件も持ったことの無い新しい利用者でも 0 件", () => {
    const db = openDb();
    db.prepare("INSERT INTO users (id, name, password_hash) VALUES ('new', '新人', 'x')").run();
    assert.equal(pageTasks(db, "new").length, 0);
    assert.equal(listTasksByQuery(qs("assignee=new"), db).length, 0);
    assert.equal(csvRows(exportTasksCsv(parseTaskFilter(qs("assignee=new"), db), db)), 0);
  });

  it("担当のタスクを削除しただけの利用者でも 0 件", () => {
    const db = openDb();
    for (const t of listTasks({ assignees: ["suzuki"], includeArchived: true }, db)) assert.equal(deleteTask(t.id, "suzuki", db), "deleted");
    assert.ok(!listAssignees(db).some((a) => a.id === "suzuki"));
    assert.equal(listTasksByQuery(qs("assignee=suzuki"), db).length, 0);
  });

  it("アーカイブ済みのタスクだけを持つ利用者は、アーカイブを含めないと 0 件、含めるとそのタスクが出る", () => {
    const db = openDb();
    const ids = listTasks({ assignees: ["suzuki"] }, db).map((t) => t.id);
    for (const id of ids) updateTask(id, { archived: true }, db);
    assert.equal(listTasksByQuery(qs("assignee=suzuki"), db).length, 0);
    assert.deepEqual(
      listTasksByQuery(qs("assignee=suzuki&archived=include"), db).map((t) => t.id).sort(),
      [...ids].sort(),
    );
  });

  it("鈴木と佐藤を組み合わせると、佐藤の担当のタスクだけが出る（画面・CSV・API）", () => {
    const db = handOverSuzuki();
    const sato = listTasks({ assignees: ["sato"] }, db);
    assert.ok(sato.length > 0);
    assert.ok(sato.length < listTasks({}, db).length);
    const satoIds = sato.map((t) => t.id).sort();
    assert.deepEqual(pageTasks(db, ["suzuki", "sato"]).map((t) => t.id).sort(), satoIds);
    assert.deepEqual(listTasksByQuery(qs("assignee=suzuki&assignee=sato"), db).map((t) => t.id).sort(), satoIds);
    assert.equal(csvRows(exportTasksCsv(parseTaskFilter(qs("assignee=suzuki&assignee=sato"), db), db)), sato.length);
  });

  it("鈴木と担当者なし（none）を組み合わせても条件は両方残り、どちらのタスクも無ければ 0 件", () => {
    const db = handOverSuzuki();
    assert.deepEqual(parseTaskFilter(qs("assignee=suzuki&assignee=none"), db).assignees, ["suzuki", "none"]);
    assert.equal(listTasksByQuery(qs("assignee=suzuki&assignee=none"), db).length, 0);
  });

  it("絞り込みのフォームから送っても、鈴木の条件は捨てられない", () => {
    const db = handOverSuzuki();
    assert.deepEqual(filterConditionsFromForm(qs("assignee=suzuki"), db).assignees, ["suzuki"]);
  });
});

describe("担当者の値の検証", () => {
  it("担当のタスクが無い利用者は、有効な担当者として扱う", () => {
    const db = handOverSuzuki();
    assert.equal(parseAssignee("suzuki", db), "suzuki");
    assert.deepEqual(parseAssignees(["suzuki", "sato", "suzuki"], db), ["suzuki", "sato"]);
  });

  it("利用者でない値・空文字・文字列でない値・SQL のような値は、これまでどおり指定なし", () => {
    const db = handOverSuzuki();
    for (const v of ["nobody", "", " suzuki", "SUZUKI", "' OR 1=1 --", undefined, null, 5, ["suzuki"]]) {
      assert.equal(parseAssignee(v, db), undefined, String(v));
    }
    assert.deepEqual(parseAssignees(["nobody"], db), []);
    const all = listTasks({}, db).length;
    assert.equal(listTasksByQuery(qs("assignee=nobody"), db).length, all);
    assert.equal(csvRows(exportTasksCsv(parseTaskFilter(qs("assignee=nobody"), db), db)), all);
  });

  it("担当者なし（none）は、これまでどおり単独でも絞り込める（担当者の決まっていないタスクが無ければ 0 件）", () => {
    const db = openDb();
    assert.equal(parseAssignee("none", db), "none");
    assert.equal(listTasksByQuery(qs("assignee=none"), db).length, 0);
  });
});

describe("一覧の画面の担当者の絞り込みの選択肢", () => {
  it("担当のタスクが無い利用者も出て、最後に担当者なしが出る", () => {
    const db = handOverSuzuki();
    db.prepare("INSERT INTO users (id, name, password_hash) VALUES ('new', '新人', 'x')").run();
    const options = buildAssigneeFilterOptions([], db);
    assert.deepEqual(
      options.map((o) => o.value),
      ["new", "sato", "suzuki", "tanaka", "none"],
    );
    assert.equal(options.find((o) => o.value === "suzuki")?.label, "鈴木");
    assert.equal(options.at(-1)?.label, "担当者なし");
  });

  it("選んだ鈴木は、絞り込んだあとも選んだ状態で残る", () => {
    const db = handOverSuzuki();
    const selected = parseAssignees(["suzuki", "none"], db);
    const checked = buildAssigneeFilterOptions(selected, db).filter((o) => o.checked).map((o) => o.value);
    assert.deepEqual(checked, ["suzuki", "none"]);
  });
});

describe("保存しておいた絞り込み", () => {
  it("担当のタスクが無い利用者の条件も覚えておき、次に開いたときも 0 件で出る", () => {
    const db = handOverSuzuki();
    resolveTaskViewQuery("tanaka", { assignee: "suzuki" }, false, db);
    const loaded = resolveTaskViewQuery("tanaka", {}, false, db);
    assert.deepEqual(loaded.assignee, ["suzuki"]);
    assert.equal(listTasks({ assignees: parseAssignees(loaded.assignee, db) }, db).length, 0);
  });

  it("覚えたあとで担当のタスクが無くなっても、読み直したときに条件を捨てない", () => {
    const db = openDb();
    saveTaskViewPrefs("tanaka", { assignee: "suzuki" }, db);
    handOverSuzukiOn(db);
    assert.deepEqual(loadTaskViewPrefs("tanaka", db).assignee, ["suzuki"]);
  });

  it("利用者でない値は、これまでどおり覚えない", () => {
    const db = openDb();
    saveTaskViewPrefs("tanaka", { assignee: "nobody" }, db);
    assert.equal(loadTaskViewPrefs("tanaka", db).assignee, undefined);
  });
});

describe("ほかの担当者の選択肢は変えない", () => {
  it("GET /api/assignees の中身（listAssignees）は、これまでどおり担当のタスクがある人だけ", () => {
    const db = handOverSuzuki();
    assert.ok(!listAssignees(db).some((a) => a.id === "suzuki"));
  });

  it("まとめての変更・新しいタスクの選択肢（listAssigneeOptions）は、これまでどおり利用者の全員", () => {
    const db = handOverSuzuki();
    assert.deepEqual(listAssigneeOptions(db).map((o) => o.id).sort(), ["sato", "suzuki", "tanaka"]);
  });
});

function handOverSuzukiOn(db: Db): void {
  const ids = listTasks({ assignees: ["suzuki"] }, db).map((t) => t.id);
  updateTasks(ids, { assignee: "sato" }, db);
}
