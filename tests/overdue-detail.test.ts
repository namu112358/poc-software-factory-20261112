import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOverdue, todayInJapan } from "../src/lib/tasks.ts";

// タスク詳細の「期限切れ」は、一覧と同じ isOverdue で判定する。
describe("タスク詳細の期限切れ判定（isOverdue）", () => {
  const today = "2026-11-12";

  it("期限が昨日で未完了なら期限切れ", () => {
    assert.equal(isOverdue({ status: "todo", dueDate: "2026-11-11" }, today), true);
    assert.equal(isOverdue({ status: "in_progress", dueDate: "2026-11-11" }, today), true);
  });
  it("期限が今日なら期限切れにしない", () => {
    assert.equal(isOverdue({ status: "todo", dueDate: today }, today), false);
  });
  it("期限を過ぎていても完了なら期限切れにしない", () => {
    assert.equal(isOverdue({ status: "done", dueDate: "2026-11-01" }, today), false);
  });
  it("「今日」は日本時間で決まる（UTC 15:00 で日付が変わる）", () => {
    const now = new Date("2026-11-11T15:00:00Z"); // 日本時間 11/12 0:00
    assert.equal(todayInJapan(now), "2026-11-12");
    assert.equal(isOverdue({ status: "todo", dueDate: "2026-11-11" }, todayInJapan(now)), true);
  });
});
