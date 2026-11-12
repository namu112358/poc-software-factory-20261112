import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clearFilterHref } from "../src/lib/tasks.ts";

describe("clearFilterHref", () => {
  it("0 件のときは、覚えた条件も消す一覧（/tasks?reset=1）へのリンク先を返す", () => {
    assert.equal(clearFilterHref(0), "/tasks?reset=1");
  });
  it("1 件以上のときは null（リンクを表示しない）", () => {
    assert.equal(clearFilterHref(1), null);
    assert.equal(clearFilterHref(25), null);
  });
});
