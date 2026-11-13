import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backToTaskListHref, taskRowAnchorId } from "../src/lib/task-list-anchor.ts";

describe("一覧へ戻るリンク", () => {
  it("開いていたタスクの行の目印へ移動する", () => {
    assert.equal(backToTaskListHref(42), `/tasks#${taskRowAnchorId(42)}`);
  });
  it("絞り込み・並び順のクエリは付けない（覚えた条件がそのまま使われる）", () => {
    assert.ok(!backToTaskListHref(42).includes("?"));
  });
  it("タスクごとに別の目印になる（行の目印が重ならない）", () => {
    assert.notEqual(taskRowAnchorId(1), taskRowAnchorId(11));
  });
});
