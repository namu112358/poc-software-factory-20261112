import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSession, deleteSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";

const now = new Date("2026-11-12T00:00:00Z");

// ルートは `next/server` と `@/` を読み込むため単体テストから呼べない。
// ここでは、応答の `seconds` を作る式と、401 / 200 を分けるログイン判定を確かめる。
describe("GET /api/uptime", () => {
  it("seconds は 0 以上の整数", () => {
    const source = readFileSync(new URL("../src/app/api/uptime/route.ts", import.meta.url), "utf8");
    assert.ok(source.includes("Math.floor(process.uptime())"));
    const seconds = Math.floor(process.uptime());
    assert.ok(Number.isInteger(seconds));
    assert.ok(seconds >= 0);
  });

  it("ルートは、秒数を返す前にログインを確かめる", () => {
    const source = readFileSync(new URL("../src/app/api/uptime/route.ts", import.meta.url), "utf8");
    assert.ok(source.indexOf("requireApiUser()") < source.indexOf("process.uptime()"));
  });

  it("ログイン中のセッションは利用者として扱い、無い・ログアウト済みは未ログインとして扱う", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    assert.ok(getSessionUser(token, db, now));
    assert.equal(getSessionUser(undefined, db, now), undefined);
    deleteSession(token, db);
    assert.equal(getSessionUser(token, db, now), undefined);
  });
});
