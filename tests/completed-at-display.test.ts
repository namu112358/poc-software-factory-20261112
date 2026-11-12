import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCompletedAt } from "../src/lib/tasks.ts";

describe("formatCompletedAt（詳細の「完了」欄）", () => {
  it("完了済みで完了日時があれば、日本時間で出す", () => {
    assert.equal(formatCompletedAt({ status: "done", completedAt: "2026-11-01T15:30:00.000Z" }), "2026/11/02 00:30");
  });
  it("未完了のタスクは「—」", () => {
    assert.equal(formatCompletedAt({ status: "todo", completedAt: null }), "—");
  });
  it("完了済みでも完了日時が無ければ「—」", () => {
    assert.equal(formatCompletedAt({ status: "done", completedAt: null }), "—");
  });
});
