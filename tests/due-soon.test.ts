import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDueSoon, isOverdue, todayInJapan } from "../src/lib/tasks.ts";

// タスク詳細の「期限が近い」は isDueSoon で判定する（期限の 3 日前から当日まで。暦の日数）。
describe("isDueSoon", () => {
  const today = "2026-11-12";
  it("期限が 3 日後までの未完了のタスクは近い（当日を含む）", () => {
    assert.equal(isDueSoon({ status: "todo", dueDate: "2026-11-12" }, today), true);
    assert.equal(isDueSoon({ status: "todo", dueDate: "2026-11-13" }, today), true);
    assert.equal(isDueSoon({ status: "in_progress", dueDate: "2026-11-15" }, today), true);
  });
  it("4 日後以降の期限は近くない", () => {
    assert.equal(isDueSoon({ status: "todo", dueDate: "2026-11-16" }, today), false);
    assert.equal(isDueSoon({ status: "todo", dueDate: "2027-01-01" }, today), false);
  });
  it("完了したタスクは近くない", () => {
    assert.equal(isDueSoon({ status: "done", dueDate: "2026-11-13" }, today), false);
  });
  it("期限を過ぎたタスクは近くない（期限切れと同時に出ない）", () => {
    assert.equal(isDueSoon({ status: "todo", dueDate: "2026-11-11" }, today), false);
    for (const d of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-15", "2026-11-16"]) {
      const t = { status: "todo" as const, dueDate: d };
      assert.equal(isDueSoon(t, today) && isOverdue(t, today), false);
    }
  });
  it("月・年をまたいでも暦の日数で数える（土日も数える）", () => {
    assert.equal(isDueSoon({ status: "todo", dueDate: "2026-12-01" }, "2026-11-28"), true);
    assert.equal(isDueSoon({ status: "todo", dueDate: "2026-12-02" }, "2026-11-28"), false);
    assert.equal(isDueSoon({ status: "todo", dueDate: "2027-01-02" }, "2026-12-30"), true);
  });
  it("今日は日本時間で決まる（UTC 15:00 で日付が変わる）", () => {
    const due = { status: "todo" as const, dueDate: "2026-11-15" };
    // UTC 11/11 14:59 = JST 11/11 → 4 日後で近くない。UTC 15:00 = JST 11/12 → 3 日後で近い
    assert.equal(isDueSoon(due, todayInJapan(new Date("2026-11-11T14:59:59Z"))), false);
    assert.equal(isDueSoon(due, todayInJapan(new Date("2026-11-11T15:00:00Z"))), true);
  });
  it("日付として読めない期限は近くない", () => {
    assert.equal(isDueSoon({ status: "todo", dueDate: "" }, today), false);
  });
});
