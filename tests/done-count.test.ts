import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDoneCount } from "../src/lib/tasks.ts";

test("完了したタスクの件数と全体の件数を出す", () => {
  const tasks = [{ status: "done" }, { status: "todo" }, { status: "done" }, { status: "in_progress" }] as const;
  assert.equal(formatDoneCount([...tasks]), "完了 2 件 / 全 4 件");
});

test("タスクが 0 件のときは「完了 0 件 / 全 0 件」", () => {
  assert.equal(formatDoneCount([]), "完了 0 件 / 全 0 件");
});
