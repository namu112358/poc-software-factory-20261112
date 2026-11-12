import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { todayInJapan } from "../src/lib/tasks.ts";

// GET /api/time-zone が返す "Asia/Tokyo" は、期限の判定の「今日」を決めるタイムゾーンと同じでなければならない。
// （Route 本体は next/headers に依存し、npm test の設定のままでは呼べないので、サーバーを起動して確かめた。）
describe("日付の判定に使うタイムゾーン", () => {
  it("todayInJapan は Asia/Tokyo の日付を返す（UTC では前日でも、日本時間の日付）", () => {
    const now = new Date("2026-11-12T16:00:00Z");
    assert.equal(todayInJapan(now), "2026-11-13");
    assert.equal(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now), todayInJapan(now));
  });
});
