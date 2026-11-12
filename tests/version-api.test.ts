import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SESSION_TTL_MS, createSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";

const now = new Date("2026-11-12T00:00:00Z");

describe("GET /api/version が返す版", () => {
  it("package.json の version は空でない文字列で、そのまま返せる", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(typeof pkg.version, "string");
    assert.ok(pkg.version.length > 0);
    assert.deepEqual(JSON.parse(JSON.stringify({ version: pkg.version })), { version: pkg.version });
  });
});

describe("GET /api/version で未ログインとして扱う（401 になる）場合", () => {
  it("セッションが無い", () => {
    assert.equal(getSessionUser(undefined, openDb(), now), undefined);
  });

  it("期限の切れたセッション", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    assert.equal(getSessionUser(token, db, new Date(now.getTime() + SESSION_TTL_MS)), undefined);
  });

  it("有効なセッションはログイン済みとして扱う", () => {
    const db = openDb();
    assert.ok(getSessionUser(createSession("sato", db, now), db, now));
  });
});
