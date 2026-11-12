import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PRIORITY_LABELS, TASK_PRIORITIES } from "../src/lib/tasks.ts";

// GET /api/priorities は、この 2 つの定数から一覧を作って返す（ルートは next/server を読み込むため、ここでは呼べない）。
describe("GET /api/priorities の元になる定数", () => {
  it("値は high・medium・low の順で、名前は画面の表示（高・中・低）と同じ", () => {
    const priorities = TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }));
    assert.deepEqual(priorities, [
      { value: "high", label: "高" },
      { value: "medium", label: "中" },
      { value: "low", label: "低" },
    ]);
  });
});
