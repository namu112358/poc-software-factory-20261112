import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatJstDate } from "../src/lib/tasks.ts";

describe("formatJstDate（作成日の表示）", () => {
  it("日本時間の日付を YYYY-MM-DD で返す", () => {
    assert.equal(formatJstDate("2026-11-01T03:00:00.000Z"), "2026-11-01");
  });
  it("UTC 14:59 はまだ同じ日、15:00 で翌日になる", () => {
    assert.equal(formatJstDate("2026-10-31T14:59:59.999Z"), "2026-10-31");
    assert.equal(formatJstDate("2026-10-31T15:00:00.000Z"), "2026-11-01");
  });
  it("月末・年末をまたぐ", () => {
    assert.equal(formatJstDate("2026-12-31T15:00:00.000Z"), "2027-01-01");
  });
  it("解釈できない値は「—」", () => {
    assert.equal(formatJstDate(""), "—");
  });
});
