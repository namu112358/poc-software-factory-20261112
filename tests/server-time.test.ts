import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOverdue, todayInJapan } from "../src/lib/tasks.ts";

// GET /api/server-time の `now`・`today` は、次の 2 つの式で作る（ルートは next/server を読み込むため直接は呼べない）。
const body = (at: Date) => ({ now: at.toISOString(), today: todayInJapan(at) });

describe("GET /api/server-time の応答の中身", () => {
  it("now は UTC の ISO 8601、today は YYYY-MM-DD の形", () => {
    const res = body(new Date("2026-11-12T03:04:05.678Z"));
    assert.equal(res.now, "2026-11-12T03:04:05.678Z");
    assert.match(res.today, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("today は日本時間の日付。UTC 14:59 は同じ日、15:00 で翌日になる", () => {
    assert.equal(body(new Date("2026-10-31T14:59:59Z")).today, "2026-10-31");
    assert.equal(body(new Date("2026-10-31T15:00:00Z")).today, "2026-11-01");
  });

  it("年の変わり目も日本時間で数える", () => {
    assert.equal(body(new Date("2026-12-31T15:00:00Z")).today, "2027-01-01");
  });

  it("today は期限切れの判定（isOverdue）に使う今日と同じ", () => {
    const at = new Date("2026-10-31T15:00:00Z");
    const { today } = body(at);
    assert.equal(today, todayInJapan(at));
    assert.equal(isOverdue({ status: "todo", dueDate: "2026-10-31" }, today), true);
    assert.equal(isOverdue({ status: "todo", dueDate: "2026-11-01" }, today), false);
  });
});
