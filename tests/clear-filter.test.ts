import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clearFilterHref } from "../src/lib/tasks.ts";

describe("clearFilterHref", () => {
  it("0 件のときは、クエリなしの一覧（/tasks）へのリンク先を返す", () => {
    assert.equal(clearFilterHref(0), "/tasks");
  });
  it("1 件以上のときは null（リンクを表示しない）", () => {
    assert.equal(clearFilterHref(1), null);
    assert.equal(clearFilterHref(25), null);
  });
});
