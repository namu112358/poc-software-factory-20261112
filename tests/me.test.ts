import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SESSION_TTL_MS, createSession, deleteSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";
import { toMeResponse } from "../src/lib/me.ts";
import type { User } from "../src/lib/users.ts";

const now = new Date("2026-11-12T00:00:00Z");

describe("GET /api/me の応答", () => {
  it("ログイン中のユーザーの id と name を返す", () => {
    const db = openDb();
    const user = getSessionUser(createSession("sato", db, now), db, now);
    assert.ok(user);
    assert.deepEqual(toMeResponse({ ...user, role: "member" }), {
      user: { id: "sato", name: "佐藤", role: "member" },
      loginNotice: null,
      lockNotice: null,
    });
  });

  it("パスワードのハッシュやトークンが混ざっていても、id と name 以外は返さない", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    const row = db.prepare("SELECT id, name, password_hash FROM users WHERE id = 'sato'").get() as Record<string, string>;
    const leaky = { ...row, token, role: "member" } as unknown as User & { role: "member" };
    const body = toMeResponse(leaky);
    assert.deepEqual(Object.keys(body), ["user", "loginNotice", "lockNotice"]);
    assert.deepEqual(Object.keys(body.user).sort(), ["id", "name", "role"]);
    const text = JSON.stringify(body);
    assert.ok(!text.includes(row.password_hash));
    assert.ok(!text.includes(token));
  });

  it("2 人が同時にログインしていても、それぞれ本人を返す", () => {
    const db = openDb();
    const sato = createSession("sato", db, now);
    const suzuki = createSession("suzuki", db, now);
    assert.equal(toMeResponse({ ...getSessionUser(sato, db, now)!, role: "member" }).user.id, "sato");
    assert.equal(toMeResponse({ ...getSessionUser(suzuki, db, now)!, role: "member" }).user.id, "suzuki");
  });
});

describe("GET /api/me で未ログインとして扱う（401 になる）場合", () => {
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

  it("不明なトークンと、Cookie が無いとき", () => {
    const db = openDb();
    assert.equal(getSessionUser("unknown", db, now), undefined);
    assert.equal(getSessionUser("", db, now), undefined);
    assert.equal(getSessionUser(undefined, db, now), undefined);
  });
});
