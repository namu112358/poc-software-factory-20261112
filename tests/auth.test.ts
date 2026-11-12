import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SESSION_TTL_MS, authenticate, createSession, deleteSession, getSessionUser } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { hashPassword, verifyPassword } from "../src/lib/password.ts";

describe("password", () => {
  it("verifies only the original password", () => {
    const stored = hashPassword("secret");
    assert.equal(verifyPassword("secret", stored), true);
    assert.equal(verifyPassword("wrong", stored), false);
    assert.equal(verifyPassword("secret", "not-a-hash"), false);
  });
});

describe("authenticate", () => {
  it("accepts the seed password and rejects others", () => {
    const db = openDb();
    assert.deepEqual(authenticate("sato", SEED_PASSWORD, db), { id: "sato", name: "佐藤" });
    assert.equal(authenticate("sato", "wrong", db), undefined);
    assert.equal(authenticate("nobody", SEED_PASSWORD, db), undefined);
  });

  it("rejects users without a password hash", () => {
    const db = openDb();
    db.prepare("UPDATE users SET password_hash = '' WHERE id = 'sato'").run();
    for (const pw of ["", SEED_PASSWORD, "dummy-password-for-timing"]) assert.equal(authenticate("sato", pw, db), undefined);
  });
});

describe("sessions", () => {
  it("resolves a token to its user until it expires or is deleted", () => {
    const db = openDb();
    const now = new Date("2026-11-09T00:00:00Z");
    const token = createSession("suzuki", db, now);
    assert.equal(getSessionUser(token, db, now)?.id, "suzuki");
    assert.equal(getSessionUser(token, db, new Date(now.getTime() + SESSION_TTL_MS + 1)), undefined);
    assert.equal(getSessionUser("unknown", db, now), undefined);
    assert.equal(getSessionUser(undefined, db, now), undefined);
    deleteSession(token, db);
    assert.equal(getSessionUser(token, db, now), undefined);
  });
});
