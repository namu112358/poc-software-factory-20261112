import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDaysLeft, todayInJapan } from "../src/lib/tasks.ts";

const today = "2026-11-12";

describe("formatDaysLeft", () => {
  it("期限が今日より後なら「あと N 日」", () => {
    assert.equal(formatDaysLeft({ status: "todo", dueDate: "2026-11-15" }, today), "あと 3 日");
    assert.equal(formatDaysLeft({ status: "todo", dueDate: "2026-11-13" }, today), "あと 1 日");
  });
  it("期限が今日なら「今日まで」", () => {
    assert.equal(formatDaysLeft({ status: "in_progress", dueDate: today }, today), "今日まで");
  });
  it("期限が過ぎていれば「N 日超過」", () => {
    assert.equal(formatDaysLeft({ status: "todo", dueDate: "2026-11-10" }, today), "2 日超過");
  });
  it("月・年をまたいでも日数が合う", () => {
    assert.equal(formatDaysLeft({ status: "todo", dueDate: "2027-01-02" }, "2026-12-30"), "あと 3 日");
    assert.equal(formatDaysLeft({ status: "todo", dueDate: "2026-02-27" }, "2026-03-02"), "3 日超過");
  });
  it("完了したタスクには表示しない", () => {
    assert.equal(formatDaysLeft({ status: "done", dueDate: "2026-11-20" }, today), undefined);
    assert.equal(formatDaysLeft({ status: "done", dueDate: "2026-11-01" }, today), undefined);
  });
});

describe("todayInJapan", () => {
  it("UTC では前日でも、日本時間の日付を返す", () => {
    assert.equal(todayInJapan(new Date("2026-11-11T15:30:00Z")), "2026-11-12");
    assert.equal(todayInJapan(new Date("2026-11-11T14:59:00Z")), "2026-11-11");
  });
});
