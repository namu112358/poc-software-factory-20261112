import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SESSION_TTL_MS, createSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const now = new Date("2026-11-12T00:00:00Z");

describe("GET /api/request-id が返す id", () => {
  it("UUID の形で、呼ぶたびに違う値になる", () => {
    const ids = Array.from({ length: 100 }, () => randomUUID());
    for (const id of ids) assert.match(id, UUID);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("GET /api/request-id で未ログインとして扱う（401 になる）場合", () => {
  it("ログイン中の利用者は、番号を取れる（ユーザーが取れる）", () => {
    const db = openDb();
    assert.ok(getSessionUser(createSession("sato", db, now), db, now));
  });

  it("期限の切れたセッション・不明なトークン・Cookie が無いとき", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    assert.equal(getSessionUser(token, db, new Date(now.getTime() + SESSION_TTL_MS)), undefined);
    assert.equal(getSessionUser("unknown", db, now), undefined);
    assert.equal(getSessionUser(undefined, db, now), undefined);
  });
});
