import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { formatAssigneeChange, listAssigneeChanges, type AssigneeChange } from "../src/lib/assignee-history.ts";
import { deleteTask, getTask, updateTask, updateTaskIfUnchanged, validateTaskInput } from "../src/lib/tasks.ts";

// 担当者の変更の履歴（#99）。初期データのタスク 1 の担当者は sato（佐藤）。

function count(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM task_assignee_changes").get() as { n: number }).n;
}

describe("担当者を変える更新で履歴を記録する", () => {
  it("担当者を変えると履歴が 1 件増え、変更前・変更後・変更した人・日時（UTC）が残る", () => {
    const db = openDb();
    const task = updateTask(1, { assignee: "tanaka" }, db, "suzuki")!;
    const changes = listAssigneeChanges(1, db);
    assert.equal(changes.length, 1);
    const [c] = changes;
    assert.equal(c.fromAssignee, "sato");
    assert.equal(c.toAssignee, "tanaka");
    assert.equal(c.changedBy, "suzuki");
    assert.match(c.changedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(c.changedAt, task.updatedAt);
  });

  it("確認つきの更新（expectedUpdatedAt）でも記録する", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    const result = updateTaskIfUnchanged(1, { assignee: "suzuki" }, before.updatedAt, db, "tanaka");
    assert.ok(result.ok);
    assert.equal(count(db), 1);
    assert.equal(listAssigneeChanges(1, db)[0].changedBy, "tanaka");
  });

  it("続けて変えると、前の変更後が次の変更前になる", () => {
    const db = openDb();
    updateTask(1, { assignee: "suzuki" }, db, "sato");
    updateTask(1, { assignee: "tanaka" }, db, "suzuki");
    const [latest, first] = listAssigneeChanges(1, db);
    assert.deepEqual([first.fromAssignee, first.toAssignee], ["sato", "suzuki"]);
    assert.deepEqual([latest.fromAssignee, latest.toAssignee], ["suzuki", "tanaka"]);
  });

  it("変更前の担当者は、書き込む直前の DB の値（読んでから書くまでに担当者が変わっても正しい）", () => {
    const db = openDb();
    let interleaved = false;
    // 書き込む直前の読み直しより前に、ほかの人が担当者を変える。
    const racy = new Proxy(db, {
      get(target, prop) {
        if (prop !== "prepare") {
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (sql: string) => {
          if (!interleaved && sql.startsWith("UPDATE tasks")) {
            interleaved = true;
            updateTask(1, { assignee: "suzuki" }, target, "suzuki");
          }
          return target.prepare(sql);
        };
      },
    }) as Db;
    updateTask(1, { assignee: "tanaka" }, racy, "sato");
    assert.ok(interleaved);
    const [latest] = listAssigneeChanges(1, db);
    assert.deepEqual([latest.fromAssignee, latest.toAssignee], ["suzuki", "tanaka"]);
  });
});

describe("履歴を増やさない更新", () => {
  it("担当者を同じ値のまま送った更新では増えない", () => {
    const db = openDb();
    updateTask(1, { assignee: "sato" }, db, "sato");
    assert.equal(count(db), 0);
  });

  it("ほかの項目だけの更新では増えない", () => {
    const db = openDb();
    updateTask(1, { memo: "書き足した", status: "todo", dueDate: "2030-01-31" }, db, "sato");
    assert.equal(count(db), 0);
  });

  it("入力の誤り（400）では、検証で止まり増えない", () => {
    const db = openDb();
    const result = validateTaskInput({ assignee: "ghost" }, { partial: true }, db);
    assert.equal(result.ok, false);
    assert.equal(count(db), 0);
    assert.equal(getTask(1, db)!.assignee, "sato");
  });

  it("タスクが無い（404）ときは増えない", () => {
    const db = openDb();
    assert.equal(updateTask(9999, { assignee: "tanaka" }, db, "sato"), undefined);
    assert.deepEqual(updateTaskIfUnchanged(9999, { assignee: "tanaka" }, "2026-11-12T00:00:00.000Z", db, "sato"), {
      ok: false,
      reason: "not_found",
    });
    assert.equal(count(db), 0);
  });

  it("同時編集の衝突（409）では増えない", () => {
    const db = openDb();
    const start = getTask(1, db)!.updatedAt;
    updateTask(1, { memo: "先の更新" }, db, "suzuki");
    const result = updateTaskIfUnchanged(1, { assignee: "tanaka" }, start, db, "sato");
    assert.ok(!result.ok && result.reason === "conflict");
    assert.equal(count(db), 0);
  });
});

describe("タスクの更新と履歴の記録は全部か無しか", () => {
  it("履歴の書き込みが失敗したら、タスクの更新も戻る", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    // 存在しない利用者を変更した人にすると、履歴の外部キーで書き込みが失敗する。
    assert.throws(() => updateTask(1, { assignee: "tanaka", memo: "戻るはず" }, db, "ghost"));
    assert.deepEqual(getTask(1, db), before);
    assert.equal(count(db), 0);
  });

  it("確認つきの更新でも、履歴の書き込みが失敗したらタスクは変わらない", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    assert.throws(() => updateTaskIfUnchanged(1, { assignee: "tanaka" }, before.updatedAt, db, "ghost"));
    assert.deepEqual(getTask(1, db), before);
    assert.equal(count(db), 0);
  });

  it("ほかのトランザクションの中から呼んでも、失敗はそのトランザクションを壊さない", () => {
    const db = openDb();
    db.exec("BEGIN");
    assert.throws(() => updateTask(1, { assignee: "tanaka" }, db, "ghost"));
    updateTask(2, { memo: "続けて書ける" }, db, "sato");
    db.exec("COMMIT");
    assert.equal(getTask(1, db)!.assignee, "sato");
    assert.equal(getTask(2, db)!.memo, "続けて書ける");
  });
});

describe("履歴の並び・表示・削除", () => {
  it("新しい順に並ぶ。同じ時刻なら後から記録したものが先", () => {
    const db = openDb();
    const insert = db.prepare(
      "INSERT INTO task_assignee_changes (task_id, from_assignee, to_assignee, changed_by, changed_at) VALUES (1, ?, ?, 'sato', ?)",
    );
    insert.run("sato", "suzuki", "2026-11-10T00:00:00.000Z");
    insert.run("suzuki", "tanaka", "2026-11-12T00:00:00.000Z");
    insert.run("tanaka", "sato", "2026-11-11T00:00:00.000Z");
    insert.run("sato", "tanaka", "2026-11-12T00:00:00.000Z");
    const order = listAssigneeChanges(1, db).map((c) => `${c.fromAssignee}>${c.toAssignee}`);
    assert.deepEqual(order, ["sato>tanaka", "suzuki>tanaka", "tanaka>sato", "sato>suzuki"]);
  });

  it("ほかのタスクの履歴は混ざらず、無ければ空", () => {
    const db = openDb();
    updateTask(1, { assignee: "tanaka" }, db, "sato");
    assert.deepEqual(listAssigneeChanges(2, db), []);
  });

  it("日本時間の「YYYY/MM/DD HH:mm 変更した人 が 変更前 → 変更後 に変更」の形で表示する（日付をまたぐ時刻）", () => {
    const db = openDb();
    db.prepare(
      "INSERT INTO task_assignee_changes (task_id, from_assignee, to_assignee, changed_by, changed_at) VALUES (1, 'suzuki', 'tanaka', 'sato', '2026-11-12T15:30:00.000Z')",
    ).run();
    const [c] = listAssigneeChanges(1, db);
    assert.equal(formatAssigneeChange(c), "2026/11/13 00:30 佐藤 が 鈴木 → 田中 に変更");
  });

  it("名前が分からない利用者は ID、担当者が空なら「（なし）」、変更した人が分からなければ「（不明）」と出す", () => {
    const c: AssigneeChange = {
      id: 1,
      taskId: 1,
      fromAssignee: "",
      fromName: null,
      toAssignee: "retired",
      toName: null,
      changedBy: null,
      changedByName: null,
      changedAt: "2026-11-12T09:05:00.000Z",
    };
    assert.equal(formatAssigneeChange(c), "2026/11/12 18:05 （不明） が （なし） → retired に変更");
  });

  it("タスクを消すと履歴も消える", () => {
    const db = openDb();
    updateTask(1, { assignee: "tanaka" }, db, "sato");
    updateTask(3, { assignee: "suzuki" }, db, "sato");
    assert.equal(deleteTask(1, "tanaka", db), "deleted");
    assert.deepEqual(listAssigneeChanges(1, db), []);
    assert.equal(listAssigneeChanges(3, db).length, 1);
  });
});
