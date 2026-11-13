import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPageTitle } from "../src/lib/page-title.ts";
import { formatTaskNumber } from "../src/lib/task-format.ts";

describe("formatPageTitle", () => {
  it("画面の名前にアプリ名を続ける", () => {
    assert.equal(formatPageTitle("タスク一覧"), "タスク一覧 - タスク管理");
  });

  it("タスクの詳細は、タスクのタイトルと番号を含み、タスクごとに違う", () => {
    const a = formatPageTitle(`ログイン画面のデザイン ${formatTaskNumber(2)}`);
    const b = formatPageTitle(`ログイン画面のデザイン ${formatTaskNumber(3)}`);
    assert.equal(a, "ログイン画面のデザイン #2 - タスク管理");
    assert.notEqual(a, b);
  });

  it("名前が空（または空白だけ）ならアプリ名だけにする", () => {
    assert.equal(formatPageTitle("  "), "タスク管理");
  });
});
