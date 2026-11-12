import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_TTL_MS,
  authenticate,
  changePassword,
  createSession,
  deleteSession,
  getSessionUser,
  logoutAllDevices,
  validatePasswordChangeInput,
} from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";
import { SEED_PASSWORD } from "../src/lib/db/seed.ts";
import { MAX_FAILURES, getLockState, recordFailure } from "../src/lib/login-throttle.ts";
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

describe("validatePasswordChangeInput", () => {
  it("accepts a new password of exactly 8 characters and rejects 7", () => {
    assert.equal(validatePasswordChangeInput({ currentPassword: "old", newPassword: "abcdefgh" }).ok, true);
    assert.equal(validatePasswordChangeInput({ currentPassword: "old", newPassword: "abcdefg" }).ok, false);
  });

  it("counts characters, not UTF-16 units", () => {
    assert.equal(validatePasswordChangeInput({ currentPassword: "old", newPassword: "😀😀😀😀😀😀😀" }).ok, false);
    assert.equal(validatePasswordChangeInput({ currentPassword: "old", newPassword: "あいうえおかきく" }).ok, true);
  });

  it("rejects a new password equal to the current one", () => {
    assert.equal(validatePasswordChangeInput({ currentPassword: "samesame1", newPassword: "samesame1" }).ok, false);
  });

  it("rejects malformed bodies", () => {
    for (const body of [undefined, null, "x", [], {}, { currentPassword: "old" }, { newPassword: "abcdefgh" },
      { currentPassword: 1, newPassword: "abcdefgh" }, { currentPassword: "old", newPassword: 12345678 },
      { currentPassword: "", newPassword: "abcdefgh" }]) {
      assert.equal(validatePasswordChangeInput(body).ok, false, JSON.stringify(body));
    }
  });
});

describe("changePassword", () => {
  const NEW = "new-password-1";
  const snapshot = (db: ReturnType<typeof openDb>) => ({
    hashes: db.prepare("SELECT id, password_hash FROM users ORDER BY id").all(),
    sessions: db.prepare("SELECT token, user_id FROM sessions ORDER BY token").all(),
  });

  it("changes the password so only the new one logs in, stored as a hash", () => {
    const db = openDb();
    const current = createSession("sato", db);
    assert.deepEqual(changePassword("sato", current, { currentPassword: SEED_PASSWORD, newPassword: NEW }, db), { ok: true });
    assert.equal(authenticate("sato", NEW, db)?.id, "sato");
    assert.equal(authenticate("sato", SEED_PASSWORD, db), undefined);
    const { password_hash } = db.prepare("SELECT password_hash FROM users WHERE id = 'sato'").get() as { password_hash: string };
    assert.ok(!password_hash.includes(NEW));
    assert.ok(password_hash.startsWith("scrypt$"));
  });

  it("invalidates the user's other sessions, keeps the current one and other users' sessions", () => {
    const db = openDb();
    const current = createSession("sato", db);
    const otherDevice = createSession("sato", db);
    const someoneElse = createSession("suzuki", db);
    changePassword("sato", current, { currentPassword: SEED_PASSWORD, newPassword: NEW }, db);
    assert.equal(getSessionUser(current, db)?.id, "sato");
    assert.equal(getSessionUser(otherDevice, db), undefined);
    assert.equal(getSessionUser(someoneElse, db)?.id, "suzuki");
    assert.equal(authenticate("suzuki", SEED_PASSWORD, db)?.id, "suzuki");
  });

  it("changes nothing when the current password is wrong", () => {
    const db = openDb();
    const current = createSession("sato", db);
    createSession("sato", db);
    const before = snapshot(db);
    assert.deepEqual(changePassword("sato", current, { currentPassword: "wrong", newPassword: NEW }, db), {
      ok: false,
      reason: "wrong-password",
    });
    assert.deepEqual(snapshot(db), before);
    assert.equal(authenticate("sato", SEED_PASSWORD, db)?.id, "sato");
  });

  it("counts wrong current passwords toward the login lock and refuses while locked", () => {
    const db = openDb();
    const now = new Date("2026-11-12T00:00:00Z");
    const current = createSession("sato", db, now);
    for (let i = 0; i < MAX_FAILURES; i++) changePassword("sato", current, { currentPassword: "wrong", newPassword: NEW }, db, now);
    assert.equal(getLockState("sato", db, now).locked, true);
    const result = changePassword("sato", current, { currentPassword: SEED_PASSWORD, newPassword: NEW }, db, now);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "locked");
    assert.equal(authenticate("sato", SEED_PASSWORD, db)?.id, "sato");
  });

  it("resets the failure count after a successful change", () => {
    const db = openDb();
    const current = createSession("sato", db);
    for (let i = 0; i < MAX_FAILURES - 1; i++) changePassword("sato", current, { currentPassword: "wrong", newPassword: NEW }, db);
    changePassword("sato", current, { currentPassword: SEED_PASSWORD, newPassword: NEW }, db);
    recordFailure("sato", db);
    assert.equal(getLockState("sato", db).locked, false);
  });

  it("uses a fresh salt on every change", () => {
    const db = openDb();
    const current = createSession("sato", db);
    const hashOf = () => (db.prepare("SELECT password_hash FROM users WHERE id = 'sato'").get() as { password_hash: string }).password_hash;
    changePassword("sato", current, { currentPassword: SEED_PASSWORD, newPassword: NEW }, db);
    const first = hashOf();
    changePassword("sato", current, { currentPassword: NEW, newPassword: SEED_PASSWORD }, db);
    changePassword("sato", current, { currentPassword: SEED_PASSWORD, newPassword: NEW }, db);
    assert.notEqual(hashOf(), first);
  });
});

describe("logoutAllDevices", () => {
  const now = new Date("2026-11-12T00:00:00Z");
  const countSessions = (db: ReturnType<typeof openDb>, userId: string) =>
    (db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(userId) as { n: number }).n;

  it("deletes every session of the caller, including the calling one and expired ones", () => {
    const db = openDb();
    const current = createSession("sato", db, now);
    const other = createSession("sato", db, now);
    const expired = createSession("sato", db, new Date(now.getTime() - SESSION_TTL_MS - 1));
    assert.equal(logoutAllDevices(current, db, now)?.id, "sato");
    assert.equal(countSessions(db, "sato"), 0);
    for (const token of [current, other, expired]) assert.equal(getSessionUser(token, db, now), undefined);
  });

  it("keeps other users' sessions", () => {
    const db = openDb();
    const mine = createSession("sato", db, now);
    const theirs = createSession("suzuki", db, now);
    const theirs2 = createSession("tanaka", db, now);
    logoutAllDevices(mine, db, now);
    assert.equal(getSessionUser(theirs, db, now)?.id, "suzuki");
    assert.equal(getSessionUser(theirs2, db, now)?.id, "tanaka");
    assert.equal(countSessions(db, "suzuki"), 1);
    assert.equal(countSessions(db, "tanaka"), 1);
  });

  it("deletes nothing when not logged in (no, unknown or expired token)", () => {
    const db = openDb();
    const expired = createSession("sato", db, new Date(now.getTime() - SESSION_TTL_MS - 1));
    const alive = createSession("sato", db, now);
    const theirs = createSession("suzuki", db, now);
    for (const token of [undefined, "", "unknown", expired]) {
      assert.equal(logoutAllDevices(token, db, now), undefined);
    }
    assert.equal(countSessions(db, "sato"), 2);
    assert.equal(getSessionUser(alive, db, now)?.id, "sato");
    assert.equal(getSessionUser(theirs, db, now)?.id, "suzuki");
  });

  it("treats a second call with the same token as not logged in", () => {
    const db = openDb();
    const token = createSession("sato", db, now);
    assert.equal(logoutAllDevices(token, db, now)?.id, "sato");
    const later = createSession("sato", db, now);
    assert.equal(logoutAllDevices(token, db, now), undefined);
    assert.equal(getSessionUser(later, db, now)?.id, "sato");
  });
});
