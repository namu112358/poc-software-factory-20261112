import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATUS_LABELS, TASK_STATUSES } from "../src/lib/tasks.ts";

// GET /api/statuses（src/app/api/statuses/route.ts）は、ここで確かめる定数をそのまま並べて返す。
// ルートは next/server を読み込むため単体テストから呼べない。200・401 の応答は手動確認で確かめた。
describe("GET /api/statuses が返す元のデータ", () => {
  it("値は todo・in_progress・done の順", () => {
    assert.deepEqual([...TASK_STATUSES], ["todo", "in_progress", "done"]);
  });

  it("名前は画面の表示と同じ日本語", () => {
    const statuses = TASK_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));
    assert.deepEqual(statuses, [
      { value: "todo", label: "未着手" },
      { value: "in_progress", label: "進行中" },
      { value: "done", label: "完了" },
    ]);
  });
});
