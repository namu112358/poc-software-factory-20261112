import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commentPreview, confirmAndDeleteComment, deleteCommentConfirmMessage } from "../src/lib/comment-delete.ts";

function deps(confirmAnswer: boolean, fetchImpl?: () => Promise<{ ok: boolean }>) {
  const calls = { confirm: [] as string[], fetch: [] as { url: string; method: string }[] };
  return {
    calls,
    deps: {
      confirm: (m: string) => (calls.confirm.push(m), confirmAnswer),
      fetch: async (url: string, init: { method: "DELETE" }) => {
        calls.fetch.push({ url, method: init.method });
        return fetchImpl ? fetchImpl() : { ok: true };
      },
    },
  };
}

describe("commentPreview", () => {
  it("30 文字まではそのまま出す", () => {
    const s = "あ".repeat(30);
    assert.equal(commentPreview(s), s);
  });
  it("30 文字を超えたら先頭 30 文字と「…」にする", () => {
    assert.equal(commentPreview("あ".repeat(31)), `${"あ".repeat(30)}…`);
  });
  it("絵文字などの 2 単位の文字を途中で切らない", () => {
    assert.equal(commentPreview("😀".repeat(31)), `${"😀".repeat(30)}…`);
  });
});

describe("deleteCommentConfirmMessage", () => {
  it("確かめの文言とコメントの先頭が入る", () => {
    const m = deleteCommentConfirmMessage("先方と決めた納期");
    assert.ok(m.includes("このコメントを削除します。削除してから 30 日のあいだは元に戻せます。よろしいですか？"));
    assert.ok(m.includes("先方と決めた納期"));
  });
});

describe("confirmAndDeleteComment", () => {
  it("OK なら DELETE を送り deleted を返す", async () => {
    const { calls, deps: d } = deps(true);
    assert.deepEqual(await confirmAndDeleteComment(5, 9, "本文", d), { status: "deleted" });
    assert.deepEqual(calls.fetch, [{ url: "/api/tasks/5/comments/9", method: "DELETE" }]);
    assert.equal(calls.confirm.length, 1);
  });
  it("キャンセルなら何も送らず cancelled を返す", async () => {
    const { calls, deps: d } = deps(false);
    assert.deepEqual(await confirmAndDeleteComment(5, 9, "本文", d), { status: "cancelled" });
    assert.equal(calls.fetch.length, 0);
  });
  it("失敗の応答なら決まった文言の error を返す", async () => {
    const { deps: d } = deps(true, async () => ({ ok: false }));
    assert.deepEqual(await confirmAndDeleteComment(5, 9, "本文", d), { status: "error", message: "コメントを削除できませんでした。" });
  });
  it("通信が例外でも決まった文言の error を返す", async () => {
    const { deps: d } = deps(true, async () => {
      throw new Error("x");
    });
    assert.deepEqual(await confirmAndDeleteComment(5, 9, "本文", d), { status: "error", message: "コメントを削除できませんでした。" });
  });
});
