import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { LOCK_MS, MAX_FAILURES, clearFailures, getLockState, recordFailure } from "../src/lib/login-throttle.ts";

const T0 = new Date("2026-01-01T00:00:00Z");
const fail = (db: ReturnType<typeof openDb>, id: string, n: number, now = T0) => {
  for (let i = 0; i < n; i++) recordFailure(id, db, now);
};

describe("login throttle", () => {
  it("locks for 15 minutes after 5 consecutive failures, reporting minutes left", () => {
    const db = openDb();
    fail(db, "sato", MAX_FAILURES - 1);
    assert.deepEqual(getLockState("sato", db, T0), { locked: false });
    fail(db, "sato", 1);
    assert.deepEqual(getLockState("sato", db, T0), { locked: true, retryAfterMinutes: 15 });
    const later = new Date(T0.getTime() + 14 * 60_000 + 30_000);
    assert.deepEqual(getLockState("sato", db, later), { locked: true, retryAfterMinutes: 1 });
  });

  it("unlocks after 15 minutes and counts failures from zero again", () => {
    const db = openDb();
    fail(db, "sato", MAX_FAILURES);
    const after = new Date(T0.getTime() + LOCK_MS);
    assert.deepEqual(getLockState("sato", db, after), { locked: false });
    fail(db, "sato", MAX_FAILURES - 1, after);
    assert.deepEqual(getLockState("sato", db, after), { locked: false });
    fail(db, "sato", 1, after);
    assert.equal(getLockState("sato", db, after).locked, true);
  });

  it("resets the count when login succeeds", () => {
    const db = openDb();
    fail(db, "sato", MAX_FAILURES - 1);
    clearFailures("sato", db);
    fail(db, "sato", MAX_FAILURES - 1);
    assert.deepEqual(getLockState("sato", db, T0), { locked: false });
  });

  it("does not affect other user IDs", () => {
    const db = openDb();
    fail(db, "sato", MAX_FAILURES);
    assert.equal(getLockState("sato", db, T0).locked, true);
    assert.deepEqual(getLockState("suzuki", db, T0), { locked: false });
  });
});
