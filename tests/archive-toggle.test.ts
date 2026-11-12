import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { setTaskArchived } from "../src/lib/archive-toggle.ts";
import { getTask, updateTaskIfUnchanged } from "../src/lib/tasks.ts";

type Sent = { url: string; init: { method: "PATCH"; headers: Record<string, string>; body: string } };

function fakeFetch(res: { ok: boolean; body?: unknown } | "throw", sent: Sent[]) {
  return async (url: string, init: Sent["init"]) => {
    sent.push({ url, init });
    if (res === "throw") throw new Error("network");
    return { ok: res.ok, json: async () => res.body ?? {} };
  };
}

describe("setTaskArchived", () => {
  it("アーカイブするとき、archived: true と編集前の更新日時を PATCH で送り、done を返す", async () => {
    const sent: Sent[] = [];
    const r = await setTaskArchived(3, true, "2026-11-12T00:00:00.000Z", { fetch: fakeFetch({ ok: true }, sent) });
    assert.deepEqual(r, { status: "done", archived: true });
    assert.equal(sent[0].url, "/api/tasks/3");
    assert.equal(sent[0].init.method, "PATCH");
    assert.deepEqual(JSON.parse(sent[0].init.body), { archived: true, expectedUpdatedAt: "2026-11-12T00:00:00.000Z" });
  });

  it("戻すとき、archived: false を送り、done を返す", async () => {
    const sent: Sent[] = [];
    const r = await setTaskArchived(3, false, "2026-11-12T00:00:00.000Z", { fetch: fakeFetch({ ok: true }, sent) });
    assert.deepEqual(r, { status: "done", archived: false });
    assert.equal(JSON.parse(sent[0].init.body).archived, false);
  });

  it("API がエラーを返したら、その日本語のメッセージを返す（404・409 など）", async () => {
    const r = await setTaskArchived(999, true, "x", { fetch: fakeFetch({ ok: false, body: { error: "タスクが見つかりません" } }, []) });
    assert.deepEqual(r, { status: "error", message: "タスクが見つかりません" });
  });

  it("エラーの本文が読めないときは、日本語の既定のメッセージを返す", async () => {
    const f = async () => ({ ok: false, json: async () => { throw new Error("bad json"); } });
    assert.deepEqual(await setTaskArchived(3, true, "x", { fetch: f }), { status: "error", message: "タスクをアーカイブできませんでした。" });
    assert.deepEqual(await setTaskArchived(3, false, "x", { fetch: f }), { status: "error", message: "アーカイブを戻せませんでした。" });
  });

  it("通信が失敗したら、日本語のメッセージを返す", async () => {
    const r = await setTaskArchived(3, true, "x", { fetch: fakeFetch("throw", []) });
    assert.deepEqual(r, { status: "error", message: "タスクをアーカイブできませんでした。" });
  });
});

describe("アーカイブの切り替えで変わらないもの", () => {
  it("アーカイブしても戻しても、タイトル・担当者・期限は変わらない", () => {
    const db = openDb();
    const before = getTask(3, db)!;
    const a = updateTaskIfUnchanged(3, { archived: true }, before.updatedAt, db, "sato");
    assert.ok(a.ok);
    assert.equal(getTask(3, db)!.archived, true);
    const b = updateTaskIfUnchanged(3, { archived: false }, getTask(3, db)!.updatedAt, db, "sato");
    assert.ok(b.ok);
    const after = getTask(3, db)!;
    assert.equal(after.archived, false);
    assert.deepEqual([after.title, after.assignee, after.dueDate], [before.title, before.assignee, before.dueDate]);
  });
});
