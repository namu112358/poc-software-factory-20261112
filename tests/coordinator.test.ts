// 延長の申請を承認・却下できるのは、取りまとめる人（利用者の役割が coordinator）だけ（#420）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, openDb } from "../src/lib/db/index.ts";
import { MIGRATIONS } from "../src/lib/db/migrations.ts";
import { createExtension, decideExtension, getExtension, listMyExtensions, withdrawExtension } from "../src/lib/extensions.ts";
import { getTask } from "../src/lib/tasks.ts";
import { isCoordinator, listUserOptions, listUsers } from "../src/lib/users.ts";
import { toMeResponse } from "../src/lib/me.ts";

const input = { taskId: 3, requester: "sato", newDueDate: "2026-11-30", reason: "レビュー待ち" };
const NOW = new Date("2026-11-12T00:00:00.000Z");

function pending(db: ReturnType<typeof openDb>, requester = "sato") {
  const ext = createExtension({ ...input, requester }, db, NOW);
  if (ext === "conflict") throw new Error("setup");
  return ext;
}

describe("取りまとめる人の区別（isCoordinator）", () => {
  it("初期データでは田中だけが取りまとめる人で、佐藤・鈴木はメンバー", () => {
    const db = openDb();
    assert.equal(isCoordinator("tanaka", db), true);
    assert.equal(isCoordinator("sato", db), false);
    assert.equal(isCoordinator("suzuki", db), false);
  });

  it("見つからない ID は取りまとめる人として扱わない", () => {
    const db = openDb();
    assert.equal(isCoordinator("unknown", db), false);
    assert.equal(isCoordinator("", db), false);
  });

  it("マイグレーションの前からある DB では、田中だけが取りまとめる人になり、ほかの利用者はメンバーになる", () => {
    const old = new DatabaseSync(":memory:");
    migrate(old, MIGRATIONS.filter((m) => m.version < 23));
    old.exec("INSERT INTO users (id, name) VALUES ('sato', '佐藤'), ('tanaka', '田中'), ('yamada', '山田')");
    migrate(old);
    assert.equal(isCoordinator("tanaka", old), true);
    assert.equal(isCoordinator("sato", old), false);
    assert.equal(isCoordinator("yamada", old), false);
  });

  it("役割は member と coordinator のほかの値を入れられない", () => {
    const db = openDb();
    assert.throws(() => db.prepare("UPDATE users SET role = 'admin' WHERE id = 'sato'").run());
  });

  it("担当者の候補などの利用者の一覧には役割を出さず、ログイン中の利用者の応答には役割を足す（#524）", () => {
    const db = openDb();
    for (const u of [...listUsers(db), ...listUserOptions(db)]) assert.deepEqual(Object.keys(u).sort(), ["id", "name"]);
    assert.deepEqual(Object.keys(toMeResponse({ ...listUsers(db)[0], role: "member" }).user).sort(), ["id", "name", "role"]);
  });
});

describe("decideExtension: 取りまとめる人だけが判断できる", () => {
  for (const decision of ["approved", "rejected"] as const) {
    it(`取りまとめる人は、ほかの人の申請を ${decision} できる`, () => {
      const db = openDb();
      const ext = pending(db);
      const out = decideExtension(3, ext.id, decision, "tanaka", db, NOW);
      assert.equal(out.result, "decided");
      assert.equal(getExtension(ext.id, db)!.status, decision);
      assert.equal(getExtension(ext.id, db)!.decidedBy, "tanaka");
    });

    it(`取りまとめる人でない人が ${decision} しようとすると forbidden で、申請・期限・最終更新日時は変わらない`, () => {
      for (const userId of ["suzuki", "unknown"]) {
        const db = openDb();
        const ext = pending(db);
        const taskBefore = getTask(3, db);
        const extBefore = getExtension(ext.id, db);
        assert.deepEqual(decideExtension(3, ext.id, decision, userId, db, NOW), {
          result: "forbidden",
          reason: "not_coordinator",
        });
        assert.deepEqual(getTask(3, db), taskBefore);
        assert.deepEqual(getExtension(ext.id, db), extBefore);
      }
    });

    it(`自分の申請は、取りまとめる人でも ${decision} できない（#333 のまま）`, () => {
      const db = openDb();
      const ext = pending(db, "tanaka");
      const taskBefore = getTask(3, db);
      assert.deepEqual(decideExtension(3, ext.id, decision, "tanaka", db, NOW), { result: "forbidden", reason: "own" });
      assert.deepEqual(getTask(3, db), taskBefore);
      assert.equal(getExtension(ext.id, db)!.status, "pending");
    });
  }

  it("取りまとめる人でない人には、判断済みの申請でも conflict ではなく forbidden を返す", () => {
    const db = openDb();
    const ext = pending(db);
    decideExtension(3, ext.id, "rejected", "tanaka", db, NOW);
    assert.deepEqual(decideExtension(3, ext.id, "approved", "suzuki", db), { result: "forbidden", reason: "not_coordinator" });
    assert.equal(getExtension(ext.id, db)!.decidedBy, "tanaka");
  });

  it("申請が無い・別のタスクの申請なら、取りまとめる人でなくても not_found（無いことの判定が先）", () => {
    const db = openDb();
    const ext = pending(db);
    assert.deepEqual(decideExtension(3, 999, "approved", "suzuki", db), { result: "not_found" });
    assert.deepEqual(decideExtension(4, ext.id, "approved", "suzuki", db), { result: "not_found" });
  });

  it("メンバーを取りまとめる人に変えれば判断でき、取りまとめる人をメンバーに変えれば判断できなくなる", () => {
    const db = openDb();
    db.prepare("UPDATE users SET role = 'coordinator' WHERE id = 'suzuki'").run();
    db.prepare("UPDATE users SET role = 'member' WHERE id = 'tanaka'").run();
    const ext = pending(db);
    assert.deepEqual(decideExtension(3, ext.id, "approved", "tanaka", db), { result: "forbidden", reason: "not_coordinator" });
    assert.equal(decideExtension(3, ext.id, "approved", "suzuki", db).result, "decided");
  });
});

describe("申請・取り下げ・自分の申請の結果は、役割に関係なく使える", () => {
  for (const requester of ["sato", "tanaka"]) {
    it(`${requester} は申請・取り下げができ、自分の申請の結果を見られる`, () => {
      const db = openDb();
      const first = pending(db, requester);
      assert.equal(withdrawExtension(3, first.id, requester, db).result, "withdrawn");
      const second = pending(db, requester);
      const decider = requester === "tanaka" ? "suzuki" : "tanaka";
      db.prepare("UPDATE users SET role = 'coordinator' WHERE id = ?").run(decider);
      decideExtension(3, second.id, "approved", decider, db, NOW);
      const mine = listMyExtensions(requester, db, NOW);
      assert.deepEqual(mine.map((r) => [r.id, r.status]), [[second.id, "approved"]]);
    });
  }
});
