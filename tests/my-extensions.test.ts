import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createExtension, decideExtension, extensionStatusLabel, listMyExtensions } from "../src/lib/extensions.ts";

const base = { requester: "sato", newDueDate: "2026-11-20", reason: "理由" };
const NOW = new Date("2026-11-12T00:00:00.000Z");

function make(db: ReturnType<typeof openDb>, taskId: number, at: string, requester = "sato") {
  const e = createExtension({ ...base, taskId, requester }, db, new Date(at));
  if (e === "conflict") throw new Error("setup");
  return e;
}

describe("listMyExtensions", () => {
  it("lists only my requests, newest first", () => {
    const db = openDb();
    make(db, 3, "2026-11-01T00:00:00.000Z");
    make(db, 4, "2026-11-10T00:00:00.000Z");
    make(db, 5, "2026-11-11T00:00:00.000Z", "suzuki");
    assert.deepEqual(listMyExtensions("sato", db, NOW).map((r) => r.taskId), [4, 3]);
  });

  it("excludes requests older than 30 days and keeps the boundary", () => {
    const db = openDb();
    make(db, 3, "2026-10-13T00:00:00.000Z"); // ちょうど 30 日前
    make(db, 4, "2026-10-12T23:59:59.000Z"); // 30 日より前
    assert.deepEqual(listMyExtensions("sato", db, NOW).map((r) => r.taskId), [3]);
  });

  it("includes pending, approved and rejected, with who decided and when", () => {
    const db = openDb();
    make(db, 3, "2026-11-08T00:00:00.000Z");
    const a = make(db, 4, "2026-11-09T00:00:00.000Z");
    const r = make(db, 5, "2026-11-10T00:00:00.000Z");
    decideExtension(4, a.id, "approved", "suzuki", db, new Date("2026-11-10T03:00:00.000Z"));
    decideExtension(5, r.id, "rejected", "suzuki", db, new Date("2026-11-11T03:00:00.000Z"));
    const rows = listMyExtensions("sato", db, NOW);
    assert.deepEqual(rows.map((x) => x.status), ["rejected", "approved", "pending"]);
    assert.equal(rows[0].decidedAt, "2026-11-11T03:00:00.000Z");
    assert.ok(rows[0].decidedByName);
    assert.equal(rows[2].decidedByName, null);
    assert.equal(rows[2].decidedAt, null);
  });

  it("shows null for the decider when the data does not have one", () => {
    const db = openDb();
    const e = make(db, 3, "2026-11-09T00:00:00.000Z");
    db.prepare("UPDATE due_date_extensions SET status = 'approved' WHERE id = ?").run(e.id);
    const [row] = listMyExtensions("sato", db, NOW);
    assert.equal(row.decidedByName, null);
    assert.equal(row.decidedAt, null);
  });

  it("is empty when I have no requests", () => {
    assert.deepEqual(listMyExtensions("sato", openDb(), NOW), []);
  });
});

describe("extensionStatusLabel", () => {
  it("returns Japanese labels", () => {
    assert.deepEqual(
      (["pending", "approved", "rejected"] as const).map(extensionStatusLabel),
      ["承認待ち", "承認", "却下"],
    );
  });
});
