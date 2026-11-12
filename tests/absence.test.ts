import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import {
  clearAbsence,
  formatLeaveNote,
  formatMonthDay,
  getAbsence,
  isOnLeave,
  isOwnAbsenceTarget,
  listLeaveEndDates,
  setAbsence,
  validateAbsenceInput,
} from "../src/lib/absence.ts";
import { listAssigneeOptions, listMemberWorkload } from "../src/lib/members.ts";
import { todayInJapan } from "../src/lib/task-dates.ts";
import { updateTask, getTask } from "../src/lib/tasks.ts";
import { updateTasks, validateBulkUpdateInput } from "../src/lib/bulk-update.ts";
import { validateTaskInput } from "../src/lib/task-validation.ts";

// 休み: 2026-11-16〜2026-11-20（両端を含む）。
const LEAVE = { startDate: "2026-11-16", endDate: "2026-11-20" };

function errorsOf(body: unknown): string[] {
  const r = validateAbsenceInput(body);
  assert.equal(r.ok, false, `body=${JSON.stringify(body)}`);
  return r.ok ? [] : r.errors;
}

describe("休みの登録の検証（validateAbsenceInput）", () => {
  it("開始日と終了日を受け付ける。同じ日でもよい", () => {
    assert.deepEqual(validateAbsenceInput(LEAVE), { ok: true, value: LEAVE });
    assert.deepEqual(validateAbsenceInput({ startDate: "2026-11-16", endDate: "2026-11-16" }), {
      ok: true,
      value: { startDate: "2026-11-16", endDate: "2026-11-16" },
    });
  });

  it("終了日が開始日より前なら、日本語のエラーで受け付けない", () => {
    assert.deepEqual(errorsOf({ startDate: "2026-11-20", endDate: "2026-11-19" }), ["終了日は開始日と同じ日か、それより後にしてください"]);
  });

  it("日付が無い・形式が違う・実在しない日は、日本語のエラーで受け付けない", () => {
    assert.deepEqual(errorsOf({}), ["開始日を入力してください", "終了日を入力してください"]);
    assert.deepEqual(errorsOf(undefined), ["開始日を入力してください", "終了日を入力してください"]);
    assert.deepEqual(errorsOf({ startDate: "", endDate: 20261120 }), ["開始日を入力してください", "終了日を入力してください"]);
    assert.deepEqual(errorsOf({ startDate: "2026/11/16", endDate: "2026-11-20" }), ["開始日は正しい日付（YYYY-MM-DD）で入力してください"]);
    assert.deepEqual(errorsOf({ startDate: "2026-11-16", endDate: "2026-02-30" }), ["終了日は正しい日付（YYYY-MM-DD）で入力してください"]);
    assert.deepEqual(errorsOf({ startDate: "2026-13-01", endDate: "2026-11-20" }), ["開始日は正しい日付（YYYY-MM-DD）で入力してください"]);
  });
});

describe("休みの登録・取り消し", () => {
  it("登録した休みを読み出せ、取り消すと無くなる", () => {
    const db = openDb();
    assert.equal(getAbsence("sato", db), null);
    setAbsence("sato", LEAVE, db);
    assert.deepEqual(getAbsence("sato", db), LEAVE);
    clearAbsence("sato", db);
    assert.equal(getAbsence("sato", db), null);
  });

  it("登録し直すと前の期間を置き換え、期間は 1 つだけ", () => {
    const db = openDb();
    setAbsence("sato", LEAVE, db);
    setAbsence("sato", { startDate: "2026-12-01", endDate: "2026-12-03" }, db);
    assert.deepEqual(getAbsence("sato", db), { startDate: "2026-12-01", endDate: "2026-12-03" });
    const count = db.prepare("SELECT COUNT(*) AS n FROM user_absences WHERE user_id = 'sato'").get() as { n: number };
    assert.equal(count.n, 1);
  });

  it("登録が無いときの取り消しもエラーにならない", () => {
    const db = openDb();
    assert.doesNotThrow(() => clearAbsence("sato", db));
    assert.doesNotThrow(() => clearAbsence("sato", db));
    assert.equal(getAbsence("sato", db), null);
  });

  it("本人の登録・取り消しは、ほかのメンバーの休みを変えない", () => {
    const db = openDb();
    setAbsence("suzuki", LEAVE, db);
    setAbsence("sato", { startDate: "2026-12-01", endDate: "2026-12-03" }, db);
    clearAbsence("sato", db);
    assert.deepEqual(getAbsence("suzuki", db), LEAVE);
  });

  it("終了日が開始日より前の行は DB にも入らない", () => {
    const db = openDb();
    assert.throws(() => setAbsence("sato", { startDate: "2026-11-20", endDate: "2026-11-19" }, db));
    assert.equal(getAbsence("sato", db), null);
  });
});

describe("ほかのメンバーの休みは登録・取り消しできない（isOwnAbsenceTarget。API は false のとき 403）", () => {
  it("対象の指定が無いか本人なら許し、ほかのメンバーなら拒む", () => {
    assert.equal(isOwnAbsenceTarget("sato", undefined), true);
    assert.equal(isOwnAbsenceTarget("sato", null), true);
    assert.equal(isOwnAbsenceTarget("sato", "sato"), true);
    assert.equal(isOwnAbsenceTarget("sato", "suzuki"), false);
    assert.equal(isOwnAbsenceTarget("sato", ""), false);
    assert.equal(isOwnAbsenceTarget("sato", ["sato"]), false);
  });
});

describe("休みの判定（isOnLeave・listLeaveEndDates）", () => {
  it("開始日から終了日のあいだ（両端を含む）は休み、前後の日は休みでない", () => {
    assert.equal(isOnLeave(LEAVE, "2026-11-15"), false);
    assert.equal(isOnLeave(LEAVE, "2026-11-16"), true);
    assert.equal(isOnLeave(LEAVE, "2026-11-18"), true);
    assert.equal(isOnLeave(LEAVE, "2026-11-20"), true);
    assert.equal(isOnLeave(LEAVE, "2026-11-21"), false);
    assert.equal(isOnLeave(null, "2026-11-18"), false);
  });

  it("休み中のメンバーだけ、終了日を返す", () => {
    const db = openDb();
    setAbsence("sato", LEAVE, db);
    setAbsence("suzuki", { startDate: "2026-12-01", endDate: "2026-12-03" }, db);
    assert.deepEqual([...listLeaveEndDates(db, "2026-11-20")], [["sato", "2026-11-20"]]);
    assert.deepEqual([...listLeaveEndDates(db, "2026-11-21")], []);
  });

  it("「今日」は日本時間で決める（UTC では前日の 15:00 が、日本時間の開始日）", () => {
    const today = todayInJapan(new Date("2026-11-15T15:00:00Z"));
    assert.equal(today, "2026-11-16");
    assert.equal(isOnLeave(LEAVE, today), true);
    assert.equal(isOnLeave(LEAVE, todayInJapan(new Date("2026-11-15T14:59:59Z"))), false);
  });
});

describe("休みの表示", () => {
  it("「M/D」は先頭の 0 を付けず、年をまたいでも月と日だけ", () => {
    assert.equal(formatMonthDay("2026-11-20"), "11/20");
    assert.equal(formatMonthDay("2027-01-05"), "1/5");
    assert.equal(formatLeaveNote("2026-11-20"), "（休み: 11/20 まで）");
  });

  it("担当者の選択肢: 休み中のメンバーだけ「（休み: M/D まで）」が付く。前後の日は付かない", () => {
    const db = openDb();
    setAbsence("sato", LEAVE, db);
    for (const today of ["2026-11-16", "2026-11-20"]) {
      const options = listAssigneeOptions(db, today);
      assert.ok(options.find((o) => o.id === "sato")!.label.endsWith("（休み: 11/20 まで）"), today);
      for (const o of options.filter((o) => o.id !== "sato")) assert.ok(!o.label.includes("休み"), `${today} ${o.id}`);
    }
    for (const today of ["2026-11-15", "2026-11-21"]) {
      assert.ok(!listAssigneeOptions(db, today).some((o) => o.label.includes("休み")), today);
    }
  });

  it("担当者の選択肢: タスクを持たないメンバーにも付く", () => {
    const db = openDb();
    db.prepare("DELETE FROM tasks WHERE assignee = 'tanaka'").run();
    setAbsence("tanaka", LEAVE, db);
    const tanaka = listAssigneeOptions(db, "2026-11-18").find((o) => o.id === "tanaka")!;
    assert.equal(tanaka.label, `${tanaka.name}（未完了 0）（休み: 11/20 まで）`);
  });

  it("メンバーの一覧: 休み中のメンバーに終了日が入り、ほかは null", () => {
    const db = openDb();
    setAbsence("suzuki", LEAVE, db);
    const rows = listMemberWorkload(db, "2026-11-18");
    assert.deepEqual(rows.map((r) => [r.id, r.leaveUntil]), [["sato", null], ["suzuki", "2026-11-20"], ["tanaka", null]]);
    assert.ok(listMemberWorkload(db, "2026-11-21").every((r) => r.leaveUntil === null));
  });
});

describe("休み中のメンバーも担当者に選んで保存できる", () => {
  it("タスク詳細の編集でも、まとめての変更でも保存できる", () => {
    const db = openDb();
    setAbsence("tanaka", { startDate: "2000-01-01", endDate: "2999-12-31" }, db);

    const single = validateTaskInput({ assignee: "tanaka" }, { partial: true }, db);
    assert.equal(single.ok, true);
    if (single.ok) updateTask(2, single.value, db);
    assert.equal(getTask(2, db)!.assignee, "tanaka");

    const bulk = validateBulkUpdateInput({ ids: [3, 5], changes: { assignee: "tanaka" } }, db);
    assert.equal(bulk.ok, true);
    if (bulk.ok) assert.equal(updateTasks(bulk.value.ids, bulk.value.changes, db).ok, true);
    assert.deepEqual([getTask(3, db)!.assignee, getTask(5, db)!.assignee], ["tanaka", "tanaka"]);
  });
});
