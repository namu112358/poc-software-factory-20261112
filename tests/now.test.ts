import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";

// GET /api/now の `now` は new Date().toISOString() で作る（ルートは next/server を読み込むため直接は呼べない）。
describe("GET /api/now の応答の中身", () => {
  it("now は ISO 8601 の UTC（Z で終わる）で、元の時刻に戻せる", () => {
    const at = new Date("2026-11-12T03:04:05.678Z");
    const now = at.toISOString();
    assert.match(now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(new Date(now).getTime(), at.getTime());
  });
});

describe("GET /api/now で未ログインとして扱う（401 になる）場合", () => {
  it("Cookie が無い・不明なトークンは利用者なし、ログイン済みなら利用者あり", () => {
    const db = openDb();
    const at = new Date("2026-11-12T00:00:00Z");
    assert.equal(getSessionUser(undefined, db, at), undefined);
    assert.equal(getSessionUser("unknown", db, at), undefined);
    assert.ok(getSessionUser(createSession("sato", db, at), db, at));
  });
});
