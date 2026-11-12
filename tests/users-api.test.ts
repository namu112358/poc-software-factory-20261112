import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { listUserOptions } from "../src/lib/users.ts";

describe("listUserOptions", () => {
  it("returns every user's id and name in ascending id order", () => {
    const users = listUserOptions(openDb());
    assert.deepEqual(users.map((u) => u.id), ["sato", "suzuki", "tanaka"]);
    assert.equal(users[0].name, "佐藤");
  });

  it("returns only id and name even when the users table has other columns", () => {
    const db = openDb();
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run("secret-hash", "sato");
    for (const user of listUserOptions(db)) {
      assert.deepEqual(Object.keys(user).sort(), ["id", "name"]);
    }
    assert.ok(!JSON.stringify(listUserOptions(db)).includes("secret-hash"));
  });
});
