import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countUnestimated, formatUnestimatedCount } from "../src/lib/tasks.ts";

describe("countUnestimated", () => {
  it("見積もりが未設定（null）のタスクだけを数える（0 分は設定済み）", () => {
    assert.equal(
      countUnestimated([{ estimateMinutes: null }, { estimateMinutes: 0 }, { estimateMinutes: 30 }, { estimateMinutes: null }]),
      2,
    );
  });
  it("空なら 0", () => {
    assert.equal(countUnestimated([]), 0);
  });
});

describe("formatUnestimatedCount", () => {
  it("1 件以上なら「（見積もり未設定 N 件）」", () => {
    assert.equal(formatUnestimatedCount(3), "（見積もり未設定 3 件）");
  });
  it("0 件なら null（表示しない）", () => {
    assert.equal(formatUnestimatedCount(0), null);
  });
});
