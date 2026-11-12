import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createTask } from "../src/lib/tasks.ts";
import { listMemberWorkload, sortMembersByOverdue, truncateTitle } from "../src/lib/members.ts";

describe("truncateTitle", () => {
  it("keeps 10 characters or fewer and cuts longer titles with …", () => {
    assert.equal(truncateTitle("1234567890"), "1234567890");
    assert.equal(truncateTitle("12345678901"), "1234567890…");
    assert.equal(truncateTitle("🔥".repeat(11)), `${"🔥".repeat(10)}…`);
  });
});

describe("listMemberWorkload", () => {
  it("lists every member by id with open tasks (not done) in due-date order", () => {
    const rows = listMemberWorkload(openDb());
    assert.deepEqual(rows.map((r) => r.id), ["sato", "suzuki", "tanaka"]);
    const sato = rows[0];
    assert.equal(sato.openCount, 2);
    assert.deepEqual(sato.tasks.map((t) => t.title), ["API 設計", "E2E テストの追加"]);
    assert.equal(rows[1].openCount, 2);
    assert.deepEqual(rows[1].tasks.map((t) => t.title), ["ログイン画面のデザイン", "CI の整備"]);
  });

  it("shows zero when a member has no open tasks, and keeps the full title for the link", () => {
    const db = openDb();
    db.prepare("UPDATE tasks SET status = 'done' WHERE assignee = 'tanaka'").run();
    const tanaka = listMemberWorkload(db).find((r) => r.id === "tanaka")!;
    assert.equal(tanaka.openCount, 0);
    assert.deepEqual(tanaka.tasks, []);
    createTask({ title: "とても長い題名のタスクです", status: "todo", assignee: "tanaka", dueDate: "2026-12-01", priority: "medium", estimateMinutes: null, memo: "" } as never, db);
    const t = listMemberWorkload(db).find((r) => r.id === "tanaka")!.tasks[0];
    assert.equal(t.label, "とても長い題名のタス…");
    assert.equal(t.title, "とても長い題名のタスクです");
  });
});

describe("担当者の選択肢（件数つき）", () => {
  it("文言: 期限切れが 0 件なら出さず、1 件以上なら付ける", async () => {
    const { formatAssigneeOption } = await import("../src/lib/members.ts");
    assert.equal(formatAssigneeOption({ name: "佐藤", openCount: 5, overdueCount: 0 }), "佐藤（未完了 5）");
    assert.equal(formatAssigneeOption({ name: "佐藤", openCount: 5, overdueCount: 1 }), "佐藤（未完了 5・期限切れ 1）");
    assert.equal(formatAssigneeOption({ name: "鈴木", openCount: 0, overdueCount: 0 }), "鈴木（未完了 0）");
  });

  it("数え方: 完了・アーカイブは数えず、期限切れは今日より前だけ。ID は変わらず、一覧と同じ数になる", async () => {
    const { listAssigneeOptions } = await import("../src/lib/members.ts");
    const db = openDb();
    db.prepare("UPDATE tasks SET status = 'todo', archived = 0, due_date = '2030-01-01' WHERE assignee = 'sato'").run();
    const ids = (db.prepare("SELECT id FROM tasks WHERE assignee = 'sato' ORDER BY id").all() as { id: number }[]).map((r) => r.id);
    assert.ok(ids.length >= 2);
    db.prepare("UPDATE tasks SET due_date = '2026-11-11' WHERE id = ?").run(ids[0]); // 期限切れ
    db.prepare("UPDATE tasks SET due_date = '2026-11-12' WHERE id = ?").run(ids[1]); // 今日は期限切れではない
    if (ids[2] !== undefined) db.prepare("UPDATE tasks SET status = 'done', due_date = '2020-01-01' WHERE id = ?").run(ids[2]);
    const archivedId = createTask({ title: "古い", status: "todo", assignee: "sato", dueDate: "2020-01-01" }).id;
    db.prepare("UPDATE tasks SET archived = 1 WHERE id = ?").run(archivedId);

    const today = "2026-11-12";
    const sato = listAssigneeOptions(db, today).find((o) => o.id === "sato")!;
    const member = listMemberWorkload(db, today).find((r) => r.id === "sato")!;
    assert.equal(member.overdueCount, 1);
    assert.equal(sato.label, `佐藤（未完了 ${member.openCount}・期限切れ 1）`.replace("佐藤", sato.name));
    assert.deepEqual(listAssigneeOptions(db, today).map((o) => o.id), ["sato", "suzuki", "tanaka"]);
  });
});

describe("sortMembersByOverdue", () => {
  const m = (id: string, overdueCount: number, openCount: number) => ({ id, overdueCount, openCount });

  it("orders by overdue count desc, then open count desc, then id", () => {
    const sorted = sortMembersByOverdue([m("a", 0, 5), m("b", 2, 1), m("c", 2, 3), m("d", 1, 9), m("e", 1, 9), m("f", 0, 5)]);
    assert.deepEqual(sorted.map((r) => r.id), ["c", "b", "d", "e", "a", "f"]);
  });

  it("does not change the input and keeps members without tasks", () => {
    const input = [m("a", 0, 0), m("b", 1, 1)];
    assert.deepEqual(sortMembersByOverdue(input).map((r) => r.id), ["b", "a"]);
    assert.deepEqual(input.map((r) => r.id), ["a", "b"]);
  });

  it("uses the same overdue count as the list (archived and deleted tasks are not counted)", () => {
    const db = openDb();
    db.prepare("UPDATE tasks SET status = 'todo', archived = 0, deleted_at = NULL, due_date = '2000-01-01', assignee = 'tanaka'").run();
    db.prepare("UPDATE tasks SET archived = 1 WHERE id = (SELECT MIN(id) FROM tasks)").run();
    const rows = listMemberWorkload(db, "2026-01-01");
    assert.equal(rows.find((r) => r.id === "tanaka")!.overdueCount, rows.find((r) => r.id === "tanaka")!.openCount);
    assert.equal(sortMembersByOverdue(rows)[0].id, "tanaka");
  });
});

describe("新しいタスクの担当者の選択肢（#437）", () => {
  it("候補と並びは listUserOptions と同じで、休みの終わりの日が付き、休みの無い人には付かない", async () => {
    const { listAssigneeOptions } = await import("../src/lib/members.ts");
    const { listUserOptions } = await import("../src/lib/users.ts");
    const { setAbsence } = await import("../src/lib/absence.ts");
    const db = openDb();
    setAbsence("suzuki", { startDate: "2026-11-13", endDate: "2026-11-20" }, db);
    const options = listAssigneeOptions(db, "2026-11-15");
    assert.deepEqual(options.map((o) => o.id), listUserOptions(db).map((u) => u.id));
    assert.ok(options.find((o) => o.id === "suzuki")!.label.endsWith("（休み: 11/20 まで）"));
    assert.ok(!options.find((o) => o.id === "sato")!.label.includes("休み"));
  });

  it("これから始まる休みを登録した人にも、休みの終わりの日が付く（11/12 に 11/13〜11/20 の休み）", async () => {
    const { listAssigneeOptions } = await import("../src/lib/members.ts");
    const { setAbsence } = await import("../src/lib/absence.ts");
    const db = openDb();
    setAbsence("suzuki", { startDate: "2026-11-13", endDate: "2026-11-20" }, db);
    const options = listAssigneeOptions(db, "2026-11-12");
    assert.ok(options.find((o) => o.id === "suzuki")!.label.endsWith("（休み: 11/20 まで）"));
    assert.ok(!options.find((o) => o.id === "sato")!.label.includes("休み"));
  });
});
