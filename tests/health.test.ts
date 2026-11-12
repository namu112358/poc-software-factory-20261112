import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";

// GET /api/health のルートは `next/server` と `@/` の別名を読み込むため、単体テストから直接は呼べない。
// ここでは、ルートが 200 か 401 かを決めている判定（セッションからログイン中の利用者を引けるか）を確かめる。
describe("GET /api/health のログイン判定", () => {
  const now = new Date("2026-11-12T00:00:00Z");

  it("ログインしている（有効なセッション）と利用者が引け、ルートは 200 を返す側に進む", () => {
    const db = openDb();
    assert.ok(getSessionUser(createSession("sato", db, now), db, now));
  });

  it("ログインしていない（トークンが無い・不明）と利用者が引けず、ルートは 401 を返す側に進む", () => {
    const db = openDb();
    assert.equal(getSessionUser(undefined, db, now), undefined);
    assert.equal(getSessionUser("unknown-token", db, now), undefined);
  });
});
