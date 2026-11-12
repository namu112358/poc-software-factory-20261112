import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { listAssigneeChanges } from "../src/lib/assignee-history.ts";
import { updateTasks } from "../src/lib/bulk-update.ts";
import { completeTasks, getTask, updateTask, updateTaskIfUnchanged } from "../src/lib/tasks.ts";

// まとめての更新でも、更新日時が前回より必ず後になること（#362）。
// 時刻を引数で渡し、1 件ずつの更新と同じミリ秒（または時計が戻った）の更新を確実に作る。
// 初期データの担当者: 1 sato、2 suzuki、3 sato、4 tanaka、5 suzuki、6 sato、7 tanaka。
// 初期データのステータス: 1・7 が done、2・3 が in_progress、4・5・6 が todo。

function updatedAt(db: Db, id: number): string {
  return getTask(id, db)!.updatedAt;
}

function setUpdatedAt(db: Db, id: number, value: string): void {
  db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(value, id);
}

describe("まとめて担当者を替えたときの更新日時（#362）", () => {
  it("1 件ずつ替えた直後に同じミリ秒でまとめて替えても、履歴は替えた順に並ぶ", () => {
    const db = openDb();
    updateTask(4, { assignee: "suzuki" }, db, "sato"); // tanaka → suzuki
    const sameMs = new Date(updatedAt(db, 4));
    const result = updateTasks([4], { assignee: "sato" }, db, "tanaka", sameMs); // suzuki → sato
    assert.ok(result.ok);
    const history = listAssigneeChanges(4, db).map((c) => [c.fromAssignee, c.toAssignee, c.changedBy]);
    assert.deepEqual(history, [
      ["suzuki", "sato", "tanaka"],
      ["tanaka", "suzuki", "sato"],
    ]);
  });

  it("同じミリ秒でまとめて替えると、更新日時は前回の 1 ミリ秒後になり、履歴の日時も同じ値になる", () => {
    const db = openDb();
    setUpdatedAt(db, 4, "2026-11-12T18:24:00.123Z");
    const result = updateTasks([4], { assignee: "sato" }, db, "tanaka", new Date("2026-11-12T18:24:00.123Z"));
    assert.ok(result.ok);
    assert.equal(updatedAt(db, 4), "2026-11-12T18:24:00.124Z");
    assert.equal(listAssigneeChanges(4, db)[0].changedAt, "2026-11-12T18:24:00.124Z");
  });

  it("時計が前回の更新日時より前を指していても、更新日時は前回より後になる", () => {
    const db = openDb();
    setUpdatedAt(db, 2, "2026-11-12T18:24:00.500Z");
    const result = updateTasks([2], { status: "done" }, db, "tanaka", new Date("2026-11-12T18:23:59.000Z"));
    assert.ok(result.ok);
    assert.equal(updatedAt(db, 2), "2026-11-12T18:24:00.501Z");
    assert.equal(getTask(2, db)!.completedAt, "2026-11-12T18:24:00.501Z");
  });

  it("今の時刻が前回より後なら、今の時刻を使う", () => {
    const db = openDb();
    setUpdatedAt(db, 2, "2026-11-12T18:24:00.500Z");
    updateTasks([2], { assignee: "sato" }, db, "tanaka", new Date("2026-11-12T18:30:00.000Z"));
    assert.equal(updatedAt(db, 2), "2026-11-12T18:30:00.000Z");
  });

  it("前回の更新日時がタスクごとに違っても、それぞれの前回より後になる", () => {
    const db = openDb();
    setUpdatedAt(db, 2, "2026-11-12T18:24:00.100Z");
    setUpdatedAt(db, 4, "2026-11-12T18:24:00.900Z");
    setUpdatedAt(db, 5, "2026-11-12T18:24:00.300Z");
    const result = updateTasks([2, 4, 5], { assignee: "sato" }, db, "tanaka", new Date("2026-11-12T18:24:00.300Z"));
    assert.ok(result.ok);
    assert.equal(updatedAt(db, 2), "2026-11-12T18:24:00.300Z");
    assert.equal(updatedAt(db, 4), "2026-11-12T18:24:00.901Z");
    assert.equal(updatedAt(db, 5), "2026-11-12T18:24:00.301Z");
  });

  it("値が変わらないタスクの更新日時は変えない", () => {
    const db = openDb();
    setUpdatedAt(db, 1, "2026-11-12T18:24:00.100Z"); // 1 はもう sato
    updateTasks([1, 2], { assignee: "sato" }, db, "tanaka", new Date("2026-11-12T18:24:00.100Z"));
    assert.equal(updatedAt(db, 1), "2026-11-12T18:24:00.100Z");
  });

  it("存在しない ID が混じると、どのタスクの更新日時も変えない", () => {
    const db = openDb();
    const before = updatedAt(db, 2);
    const result = updateTasks([2, 9999], { assignee: "sato" }, db, "tanaka", new Date(Date.parse(before) + 1000));
    assert.equal(result.ok, false);
    assert.equal(updatedAt(db, 2), before);
  });

  it("まとめて替えた後に、その前に開いた編集画面から保存すると衝突になる（同じミリ秒でも）", () => {
    const db = openDb();
    const opened = updatedAt(db, 4); // 編集を始めたときの更新日時
    updateTasks([4], { assignee: "sato" }, db, "tanaka", new Date(opened));
    const result = updateTaskIfUnchanged(4, { title: "上書きしようとした題名" }, opened, db, "suzuki");
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason === "conflict");
    assert.equal(result.task.assignee, "sato");
  });
});

describe("まとめて完了にしたときの更新日時（#362）", () => {
  it("同じミリ秒・時計が戻ったときも、更新日時は前回より後になり、完了日時も同じ値になる", () => {
    const db = openDb();
    setUpdatedAt(db, 4, "2026-11-12T18:24:00.123Z");
    setUpdatedAt(db, 5, "2026-11-12T18:24:00.900Z");
    const result = completeTasks([4, 5], db, new Date("2026-11-12T18:24:00.123Z"));
    assert.ok(result.ok);
    assert.equal(updatedAt(db, 4), "2026-11-12T18:24:00.124Z");
    assert.equal(updatedAt(db, 5), "2026-11-12T18:24:00.901Z");
    assert.equal(getTask(4, db)!.completedAt, "2026-11-12T18:24:00.124Z");
  });

  it("すでに完了のタスクの更新日時・完了日時は変えない", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    completeTasks([1, 4], db, new Date(Date.parse(before.updatedAt) + 1000));
    const after = getTask(1, db)!;
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.completedAt, before.completedAt);
  });

  it("存在しない ID が混じると、どのタスクの更新日時も変えない", () => {
    const db = openDb();
    const before = updatedAt(db, 4);
    const result = completeTasks([4, 9999], db, new Date(Date.parse(before) + 1000));
    assert.equal(result.ok, false);
    assert.equal(updatedAt(db, 4), before);
  });

  it("まとめて完了にした後に、その前に開いた編集画面から保存すると衝突になる（同じミリ秒でも）", () => {
    const db = openDb();
    const opened = updatedAt(db, 4);
    completeTasks([4], db, new Date(opened));
    const result = updateTaskIfUnchanged(4, { status: "todo" }, opened, db, "suzuki");
    assert.ok(!result.ok && result.reason === "conflict");
    assert.equal(result.task.status, "done");
  });
});
