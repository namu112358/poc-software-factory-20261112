import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SESSION_TTL_MS, createSession, deleteSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";

// GET /api/ping は requireApiUser（getSessionUser の結果）だけで 200 / 401 を分ける。
// ルートは next/server を読み込み単体テストから呼べないため、ここでは判定の部分を確かめる。
const now = new Date("2026-11-12T00:00:00Z");

describe("GET /api/ping でログイン済みとして扱う（200 になる）場合", () => {
  it("有効なセッションのユーザーが得られる", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    assert.equal(getSessionUser(token, db, now)?.id, "sato");
  });
});

describe("GET /api/ping で未ログインとして扱う（401 になる）場合", () => {
  it("Cookie が無い・不明なトークン", () => {
    const db = openDb();
    assert.equal(getSessionUser(undefined, db, now), undefined);
    assert.equal(getSessionUser("unknown", db, now), undefined);
  });

  it("期限の切れたセッション", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    assert.equal(getSessionUser(token, db, new Date(now.getTime() + SESSION_TTL_MS)), undefined);
  });

  it("ログアウトしたセッション", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    deleteSession(token, db);
    assert.equal(getSessionUser(token, db, now), undefined);
  });
});
