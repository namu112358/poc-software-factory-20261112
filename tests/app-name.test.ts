import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SESSION_TTL_MS, createSession, deleteSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";

const now = new Date("2026-11-12T00:00:00Z");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name?: unknown };
const route = readFileSync(new URL("../src/app/api/app-name/route.ts", import.meta.url), "utf8");

describe("GET /api/app-name の応答", () => {
  it("返す名前のもとになる package.json の name は、空でない文字列", () => {
    assert.equal(typeof pkg.name, "string");
    assert.ok((pkg.name as string).length > 0);
  });

  it("ルートは package.json の name をそのまま { name } で返し、最初にログインを確認する", () => {
    assert.match(route, /NextResponse\.json\(\{ name: pkg\.name \}\)/);
    assert.ok(route.indexOf("requireApiUser()") < route.indexOf("pkg.name"));
  });
});

describe("GET /api/app-name で未ログインとして扱う（401 になる）場合", () => {
  it("ログイン中のセッションは利用者を返す（200 の側）", () => {
    const db = openDb();
    assert.ok(getSessionUser(createSession("sato", db, now), db, now));
  });

  it("期限の切れたセッション", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    assert.equal(getSessionUser(token, db, new Date(now.getTime() + SESSION_TTL_MS)), undefined);
  });

  it("ログアウトしたセッション・不明なトークン・Cookie 無し", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    deleteSession(token, db);
    assert.equal(getSessionUser(token, db, now), undefined);
    assert.equal(getSessionUser("unknown", db, now), undefined);
    assert.equal(getSessionUser(undefined, db, now), undefined);
  });
});
