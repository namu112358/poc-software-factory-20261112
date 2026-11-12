import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { getTask, nextUpdatedAt, parseExpectedUpdatedAt, updateTask, updateTaskIfUnchanged } from "../src/lib/tasks.ts";

// PATCH /api/tasks/:id の expectedUpdatedAt（同時編集の上書きを防ぐ確認）の判定。

describe("updateTaskIfUnchanged（expectedUpdatedAt つきの更新）", () => {
  it("expectedUpdatedAt がサーバーの更新日時と同じなら更新される", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    const result = updateTaskIfUnchanged(1, { memo: "書き足した" }, before.updatedAt, db);
    assert.ok(result.ok);
    assert.equal(result.task.memo, "書き足した");
    assert.equal(getTask(1, db)!.memo, "書き足した");
    assert.ok(result.task.updatedAt > before.updatedAt);
  });

  it("違えば conflict で、タスクは更新日時も含めて変わらず、最新のタスクを返す", () => {
    const db = openDb();
    const start = getTask(1, db)!;
    updateTask(1, { dueDate: "2030-01-31" }, db); // 鈴木さんが先に期限を変える
    const latest = getTask(1, db)!;
    const result = updateTaskIfUnchanged(1, { memo: "佐藤さんのメモ", dueDate: start.dueDate }, start.updatedAt, db);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason === "conflict");
    assert.deepEqual(result.task, latest);
    assert.deepEqual(getTask(1, db), latest);
  });

  it("同じ expectedUpdatedAt の 2 つの更新が続けて届くと、先の 1 つだけが成功し、後の 1 つは conflict", () => {
    const db = openDb();
    const start = getTask(1, db)!.updatedAt;
    const first = updateTaskIfUnchanged(1, { memo: "先" }, start, db);
    const second = updateTaskIfUnchanged(1, { memo: "後" }, start, db);
    assert.ok(first.ok);
    assert.ok(!second.ok && second.reason === "conflict");
    assert.equal(getTask(1, db)!.memo, "先");
  });

  it("タスクが無ければ not_found（conflict にしない）", () => {
    const db = openDb();
    const result = updateTaskIfUnchanged(9999, { memo: "x" }, "2026-11-12T00:00:00.000Z", db);
    assert.deepEqual(result, { ok: false, reason: "not_found" });
  });

  it("読んでから書くまでにほかの更新が入ると conflict になり、ほかの更新を消さない", () => {
    const db = openDb();
    const start = getTask(1, db)!.updatedAt;
    let interleaved = false;
    // 確認つきの UPDATE 文を用意する直前に、ほかの人の更新を割り込ませる。
    const racy = new Proxy(db, {
      get(target, prop) {
        if (prop !== "prepare") return Reflect.get(target, prop, target);
        return (sql: string) => {
          if (!interleaved && sql.startsWith("UPDATE tasks") && sql.includes(":expectedUpdatedAt")) {
            interleaved = true;
            updateTask(1, { dueDate: "2030-01-31" }, target);
          }
          return target.prepare(sql);
        };
      },
    }) as Db;
    const result = updateTaskIfUnchanged(1, { memo: "割り込まれた" }, start, racy);
    assert.ok(interleaved);
    assert.ok(!result.ok && result.reason === "conflict");
    const after = getTask(1, db)!;
    assert.equal(after.dueDate, "2030-01-31");
    assert.notEqual(after.memo, "割り込まれた");
    assert.deepEqual(result.task, after);
  });
});

describe("expectedUpdatedAt を付けない更新", () => {
  it("今までどおり、ほかの人の更新の後でも上書きされる", () => {
    const db = openDb();
    updateTask(1, { dueDate: "2030-01-31" }, db);
    const task = updateTask(1, { memo: "確認なし" }, db)!;
    assert.equal(task.memo, "確認なし");
    assert.equal(task.dueDate, "2030-01-31");
  });

  it("同じミリ秒に続けて更新しても、更新日時は前の値より後になる", () => {
    const db = openDb();
    const times = [getTask(1, db)!.updatedAt];
    for (let i = 0; i < 5; i++) times.push(updateTask(1, { memo: String(i) }, db)!.updatedAt);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], `${times[i]} > ${times[i - 1]}`);
  });
});

describe("nextUpdatedAt", () => {
  it("今の時刻が前の値より後なら今の時刻", () => {
    assert.equal(nextUpdatedAt("2026-11-12T00:00:00.000Z", new Date("2026-11-12T00:00:01.000Z")), "2026-11-12T00:00:01.000Z");
  });
  it("同じか前なら、前の値の 1 ミリ秒後", () => {
    assert.equal(nextUpdatedAt("2026-11-12T00:00:00.000Z", new Date("2026-11-12T00:00:00.000Z")), "2026-11-12T00:00:00.001Z");
    assert.equal(nextUpdatedAt("2026-11-12T00:00:05.000Z", new Date("2026-11-12T00:00:00.000Z")), "2026-11-12T00:00:05.001Z");
  });
});

describe("parseExpectedUpdatedAt", () => {
  it("無ければ undefined（確認しない）", () => {
    assert.deepEqual(parseExpectedUpdatedAt({ memo: "x" }), { ok: true, value: undefined });
    assert.deepEqual(parseExpectedUpdatedAt(undefined), { ok: true, value: undefined });
  });

  it("日時なら UTC の toISOString() の形にそろえて返す", () => {
    assert.deepEqual(parseExpectedUpdatedAt({ expectedUpdatedAt: "2026-11-12T09:00:00.123Z" }), { ok: true, value: "2026-11-12T09:00:00.123Z" });
    assert.deepEqual(parseExpectedUpdatedAt({ expectedUpdatedAt: "2026-11-12T18:00:00+09:00" }), { ok: true, value: "2026-11-12T09:00:00.000Z" });
  });

  it("日時の形でなければ誤り", () => {
    for (const v of [null, 0, "", "abc", "2026-11-12", "2026-11-12 09:00:00", "2026-11-12T09:00:00", "2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "2026-13-01T00:00:00Z", "2026-01-01T00:00:00+09:60"]) {
      const result = parseExpectedUpdatedAt({ expectedUpdatedAt: v });
      assert.equal(result.ok, false, JSON.stringify(v));
    }
  });
});
