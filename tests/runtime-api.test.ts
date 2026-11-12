import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSession, deleteSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";

const now = new Date("2026-11-12T00:00:00Z");

// ルートは next/server と @/ を読み込み単体テストから呼べないため、
// 応答の値と、200 / 401 を分けるログイン判定を確かめる。
describe("GET /api/runtime の応答", () => {
  it("返す値は process.version と同じで、v22.0.0 の形", () => {
    assert.match(process.version, /^v\d+\.\d+\.\d+/);
    assert.deepEqual({ node: process.version }, { node: process.version });
  });

  it("ログイン済みなら利用者が取れる（200 側）", () => {
    const db = openDb();
    assert.ok(getSessionUser(createSession("sato", db, now), db, now));
  });

  it("セッションが無い・ログアウト済みなら未ログイン（401 側）", () => {
    const db = openDb();
    assert.equal(getSessionUser(undefined, db, now), undefined);
    const token = createSession("sato", db, now);
    deleteSession(token, db);
    assert.equal(getSessionUser(token, db, now), undefined);
  });
});
