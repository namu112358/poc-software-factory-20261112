import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCurrentUser } from "../src/lib/tasks.ts";
import { openDb } from "../src/lib/db/index.ts";
import { getUser } from "../src/lib/users.ts";

describe("formatCurrentUser", () => {
  it("「ログイン中: 表示名」の形にする", () => {
    assert.equal(formatCurrentUser("佐藤"), "ログイン中: 佐藤");
  });

  it("ログイン ID ではなくユーザーの名前を使う", () => {
    const db = openDb();
    const user = getUser("sato", db);
    assert.ok(user);
    assert.notEqual(user.name, "sato");
    assert.equal(formatCurrentUser(user.name), `ログイン中: ${user.name}`);
  });
});
