import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate, openDb, seed, transaction } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";

describe("openDb", () => {
  it("applies all migrations and seeds an empty database", () => {
    const db = openDb();
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(user_version, MIGRATIONS.at(-1)!.version);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 3);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n, 7);
  });

  it("can skip seeding", () => {
    const db = openDb(":memory:", { seed: false });
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n, 0);
  });

  it("enforces foreign keys", () => {
    const db = openDb();
    assert.throws(() =>
      db.prepare("INSERT INTO tasks (title, status, assignee, due_date) VALUES ('x', 'todo', 'nobody', '2026-01-01')").run(),
    );
  });
});

describe("migrate / seed", () => {
  it("is idempotent", () => {
    const db = openDb();
    migrate(db);
    seed(db);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n, 7);
  });
});

describe("transaction", () => {
  it("rolls back when the callback throws", () => {
    const db = openDb();
    assert.throws(() =>
      transaction(db, () => {
        db.prepare("DELETE FROM tasks").run();
        throw new Error("boom");
      }),
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n, 7);
  });
});
