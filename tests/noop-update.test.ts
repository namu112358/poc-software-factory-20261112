import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/db/index.ts";
import { buildTaskEditBody, saveTaskEdit, taskToEditValues } from "../src/lib/task-edit.ts";
import { getTask, parseExpectedUpdatedAt, updateTask, updateTaskIfUnchanged, validateTaskInput, type Task } from "../src/lib/tasks.ts";

// 何も変えないタスクの更新では、更新日時を進めない（#514）。
// PATCH /api/tasks/:id と同じ順（本文の検証 → expectedUpdatedAt の有無で確認つきかを選ぶ）で、ライブラリの関数を呼ぶ。

type PatchResult = { status: 200; task: Task } | { status: 400 | 404 } | { status: 409; task: Task };

function patch(db: Db, id: number, body: unknown, userId = "sato"): PatchResult {
  if (!getTask(id, db)) return { status: 404 };
  const input = validateTaskInput(body, { partial: true }, db);
  const expected = parseExpectedUpdatedAt(body);
  if (!input.ok || !expected.ok) return { status: 400 };
  if (expected.value === undefined) return { status: 200, task: updateTask(id, input.value, db, userId)! };
  const result = updateTaskIfUnchanged(id, input.value, expected.value, db, userId);
  if (result.ok) return { status: 200, task: result.task };
  if (result.reason === "not_found") return { status: 404 };
  return { status: 409, task: result.task };
}

function historyCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM task_assignee_changes").get() as { n: number }).n;
}

describe("何も変えない更新では、更新日時が進まない", () => {
  it("{} を送ると 200 で今のタスクを返し、updatedAt は変わらない", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    const res = patch(db, 1, {});
    assert.equal(res.status, 200);
    assert.deepEqual(res.status === 200 && res.task, before);
    assert.deepEqual(getTask(1, db), before);
  });

  it("知らない項目だけの本文（{ foo: 1 }）は 400 で、タスクも updatedAt も変わらない（#527）", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    const res = patch(db, 1, { foo: 1 });
    assert.equal(res.status, 400);
    assert.deepEqual(getTask(1, db), before);
  });

  it("今と同じ値だけを送ったとき（各項目・すべての項目）も、updatedAt は変わらない", () => {
    const db = openDb();
    updateTask(1, { estimateMinutes: 30, memo: "メモ", archived: false }, db);
    const before = getTask(1, db)!;
    const same = {
      title: before.title,
      status: before.status,
      assignee: before.assignee,
      dueDate: before.dueDate,
      priority: before.priority,
      estimateMinutes: before.estimateMinutes,
      memo: before.memo,
      archived: before.archived,
    };
    for (const [key, value] of Object.entries(same)) {
      const res = patch(db, 1, { [key]: value });
      assert.equal(res.status, 200, key);
      assert.equal(getTask(1, db)!.updatedAt, before.updatedAt, key);
    }
    assert.equal(patch(db, 1, same).status, 200);
    assert.deepEqual(getTask(1, db), before);
  });

  it("前後の空白だけが違うタイトル（保存の前に取り除かれる）も、変更なしとして扱う", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    assert.equal(patch(db, 1, { title: `  ${before.title}  ` }).status, 200);
    assert.equal(getTask(1, db)!.updatedAt, before.updatedAt);
  });

  it("見積もり時間が null のまま null を送っても変わらず、null から数値にすると進む", () => {
    const db = openDb();
    updateTask(1, { estimateMinutes: null }, db);
    const before = getTask(1, db)!;
    patch(db, 1, { estimateMinutes: null });
    assert.equal(getTask(1, db)!.updatedAt, before.updatedAt);
    patch(db, 1, { estimateMinutes: 30 });
    assert.ok(getTask(1, db)!.updatedAt > before.updatedAt);
  });

  it("完了のタスクに同じ status を送っても、完了日時も更新日時も変わらない", () => {
    const db = openDb();
    updateTask(4, { status: "done" }, db); // 未着手のタスクを完了にする
    const before = getTask(4, db)!;
    assert.ok(before.completedAt);
    assert.equal(patch(db, 4, { status: "done", expectedUpdatedAt: before.updatedAt }).status, 200);
    assert.deepEqual(getTask(4, db), before);
  });

  it("今と同じ担当者を送っても、担当者の変更の履歴は増えない", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    const count = historyCount(db);
    patch(db, 1, { assignee: before.assignee, expectedUpdatedAt: before.updatedAt });
    assert.equal(historyCount(db), count);
  });

  it("expectedUpdatedAt が今と同じなら、何も変えない更新は 200 で updatedAt は変わらない", () => {
    const db = openDb();
    const before = getTask(1, db)!;
    const res = patch(db, 1, { expectedUpdatedAt: before.updatedAt });
    assert.equal(res.status, 200);
    assert.deepEqual(getTask(1, db), before);
  });
});

describe("何も変えない更新の後でも、同時に編集しているほかの人の保存は通る", () => {
  it("A が {} を送った後、B が編集を始めたときの updatedAt を付けて保存すると、409 にならず通る", () => {
    const db = openDb();
    const started = getTask(1, db)!.updatedAt; // A と B が読む
    assert.equal(patch(db, 1, {}, "sato").status, 200); // A
    const res = patch(db, 1, { title: "B が変えた", expectedUpdatedAt: started }, "suzuki"); // B
    assert.equal(res.status, 200);
    assert.equal(getTask(1, db)!.title, "B が変えた");
    assert.ok(getTask(1, db)!.updatedAt > started);
  });

  it("A が今と同じタイトルを送った後でも、B の保存は通る", () => {
    const db = openDb();
    const start = getTask(1, db)!;
    assert.equal(patch(db, 1, { title: start.title, expectedUpdatedAt: start.updatedAt }).status, 200);
    assert.equal(patch(db, 1, { memo: "B のメモ", expectedUpdatedAt: start.updatedAt }).status, 200);
    assert.equal(getTask(1, db)!.memo, "B のメモ");
  });
});

describe("値が変わる更新は、今までどおり更新日時が進む", () => {
  it("値が 1 つでも変わると updatedAt が進み、同時に編集している人の保存は 409 になる", () => {
    const db = openDb();
    const start = getTask(1, db)!;
    const res = patch(db, 1, { title: start.title, memo: `${start.memo}追記` }); // タイトルは同じ、メモだけ変える
    assert.equal(res.status, 200);
    assert.ok(res.status === 200 && res.task.updatedAt > start.updatedAt);
    const other = patch(db, 1, { title: "B が変えた", expectedUpdatedAt: start.updatedAt });
    assert.equal(other.status, 409);
    assert.equal(getTask(1, db)!.title, start.title);
  });

  it("同じミリ秒に、変える・変えない・変えるの順で更新しても、変えたたびに前より後になる", () => {
    const db = openDb();
    const t0 = getTask(1, db)!.updatedAt;
    const t1 = updateTask(1, { memo: "1" }, db)!.updatedAt;
    const t2 = updateTask(1, { memo: "1" }, db)!.updatedAt;
    const t3 = updateTask(1, { memo: "2" }, db)!.updatedAt;
    assert.ok(t1 > t0);
    assert.equal(t2, t1);
    assert.ok(t3 > t2);
  });

  it("値を変えてから元の値に戻す更新も、それぞれ更新日時が進む", () => {
    const db = openDb();
    const start = getTask(1, db)!;
    const changed = updateTask(1, { priority: start.priority === "high" ? "low" : "high" }, db)!;
    const restored = updateTask(1, { priority: start.priority }, db)!;
    assert.ok(changed.updatedAt > start.updatedAt);
    assert.ok(restored.updatedAt > changed.updatedAt);
  });
});

describe("何も変えない更新でも、古い expectedUpdatedAt なら今までどおり 409", () => {
  it("ほかの人が先に変えた後に、古い expectedUpdatedAt で {} を送ると 409 で、タスクは変わらない", () => {
    const db = openDb();
    const start = getTask(1, db)!.updatedAt;
    updateTask(1, { memo: "先に変えた" }, db);
    const latest = getTask(1, db)!;
    const res = patch(db, 1, { expectedUpdatedAt: start });
    assert.equal(res.status, 409);
    assert.deepEqual(getTask(1, db), latest);
  });
});

describe("画面のタスクの編集", () => {
  function fetchVia(db: Db) {
    return async (url: string, init: { method: "PATCH"; body: string }) => {
      const id = Number(url.split("/").pop());
      const res = patch(db, id, JSON.parse(init.body));
      return { ok: res.status === 200, status: res.status, json: async () => res };
    };
  }

  it("何も変えずに「保存」しても更新日時は進まず、ほかの人の保存も通る", async () => {
    const db = openDb();
    const task = getTask(1, db)!;
    const result = await saveTaskEdit(task.id, taskToEditValues(task), task.updatedAt, { fetch: fetchVia(db) });
    assert.equal(result.status, "saved");
    assert.deepEqual(getTask(1, db), task);
    const other = patch(db, 1, { memo: "ほかの人", expectedUpdatedAt: task.updatedAt }, "suzuki");
    assert.equal(other.status, 200);
  });

  it("フォームで値を 1 つ変えて保存すると、更新日時は進む", () => {
    const db = openDb();
    const task = getTask(1, db)!;
    const body = buildTaskEditBody({ ...taskToEditValues(task), memo: `${task.memo}追記` }, task.updatedAt);
    const res = patch(db, 1, body);
    assert.equal(res.status, 200);
    assert.ok(getTask(1, db)!.updatedAt > task.updatedAt);
  });
});
