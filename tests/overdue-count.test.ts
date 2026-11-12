import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countOverdue, formatOverdueCount } from "../src/lib/tasks.ts";

const today = "2026-11-12";

describe("countOverdue", () => {
  it("期限が今日より前で完了していないタスクだけを数える", () => {
    const tasks = [
      { status: "todo", dueDate: "2026-11-11" },
      { status: "in_progress", dueDate: "2026-11-01" },
      { status: "done", dueDate: "2026-11-01" },
      { status: "todo", dueDate: today },
      { status: "todo", dueDate: "2026-11-13" },
    ] as const;
    assert.equal(countOverdue([...tasks], today), 2);
  });
  it("空なら 0", () => {
    assert.equal(countOverdue([], today), 0);
  });
});

describe("formatOverdueCount", () => {
  it("1 件以上なら「期限切れ N 件」", () => {
    assert.equal(formatOverdueCount(2), "期限切れ 2 件");
  });
  it("0 件なら null（表示しない）", () => {
    assert.equal(formatOverdueCount(0), null);
  });
});
