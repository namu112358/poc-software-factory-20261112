import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { passwordOwnerMessage } from "../src/lib/password-owner.ts";

describe("パスワード変更画面の、変更する人の表示", () => {
  it("表示名を入れた文言を返す", () => {
    assert.equal(passwordOwnerMessage("佐藤"), "佐藤 さんのパスワードを変更します。");
  });
});
