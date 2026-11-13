import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TASK_DETAIL_FALLBACK_TITLE, formatPageTitle, formatTaskDetailTitle } from "../src/lib/page-title.ts";
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

describe("formatTaskDetailTitle", () => {
  const task = { id: 1, title: "要件定義書のレビュー" };

  it("ログイン中はタスクのタイトルと番号を含む", () => {
    assert.equal(formatTaskDetailTitle(true, () => task), "要件定義書のレビュー #1 - タスク管理");
  });

  it("ログイン中でタスクが無ければ「タスクが見つかりません」にする", () => {
    assert.equal(formatTaskDetailTitle(true, () => undefined), "タスクが見つかりません - タスク管理");
  });

  it("ログインしていなければタスクを読まず、タスクの有無で変わらない固定のタイトルにする", () => {
    let read = false;
    const title = formatTaskDetailTitle(false, () => {
      read = true;
      return task;
    });
    assert.equal(read, false);
    assert.equal(title, TASK_DETAIL_FALLBACK_TITLE);
    assert.ok(!title.includes(task.title));
    assert.equal(formatTaskDetailTitle(false, () => undefined), title);
  });
});
