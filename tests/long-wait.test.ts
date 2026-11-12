import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { countLongWaiting, createExtension, decideExtension, listPendingExtensions, longWaitDays } from "../src/lib/extensions.ts";

const now = new Date("2026-11-12T12:00:00.000Z");
const ago = (h: number, m = 0) => new Date(now.getTime() - (h * 60 + m) * 60000).toISOString();

describe("longWaitDays", () => {
  it("is null under 48 hours (47:59) and a day count at exactly 48 hours", () => {
    assert.equal(longWaitDays(ago(47, 59), now), null);
    assert.equal(longWaitDays(ago(48), now), 2);
  });
  it("floors the day count", () => {
    assert.equal(longWaitDays(ago(71, 59), now), 2);
    assert.equal(longWaitDays(ago(72), now), 3);
  });
});

describe("countLongWaiting", () => {
  it("counts only requests waiting 48 hours or more; 0 for none", () => {
    assert.equal(countLongWaiting([ago(1), ago(47, 59)], now), 0);
    assert.equal(countLongWaiting([ago(1), ago(48), ago(100)], now), 2);
    assert.equal(countLongWaiting([], now), 0);
  });

  it("does not count decided requests or requests for deleted tasks", () => {
    const db = openDb(":memory:");
    const ids = db.prepare("SELECT id FROM tasks WHERE deleted_at IS NULL ORDER BY id LIMIT 3").all() as { id: number }[];
    assert.ok(ids.length >= 3);
    const old = new Date(now.getTime() - 72 * 3600000);
    const a = createExtension({ taskId: ids[0].id, requester: "sato", newDueDate: "2026-11-20", reason: "x" }, db, old);
    createExtension({ taskId: ids[1].id, requester: "sato", newDueDate: "2026-11-20", reason: "x" }, db, old);
    createExtension({ taskId: ids[2].id, requester: "sato", newDueDate: "2026-11-20", reason: "x" }, db, old);
    assert.notEqual(a, "conflict");
    decideExtension(ids[0].id, (a as { id: number }).id, "rejected", "tanaka", db, now);
    db.prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(now.toISOString(), ids[1].id);
    const pending = listPendingExtensions(db);
    assert.equal(pending.length, 1);
    assert.equal(countLongWaiting(pending.map((p) => p.createdAt), now), 1);
  });
});
