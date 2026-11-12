import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createComment, deleteComment, listComments, validateCommentInput } from "../src/lib/comments.ts";

describe("validateCommentInput", () => {
  it("trims the body and accepts 1-1000 characters", () => {
    assert.deepEqual(validateCommentInput({ body: "  こんにちは \n" }), { ok: true, value: { body: "こんにちは" } });
    assert.equal(validateCommentInput({ body: "a".repeat(1000) }).ok, true);
  });

  it("rejects empty, whitespace-only, too long, non-string and non-object input", () => {
    for (const input of [{ body: "" }, { body: "  \n " }, { body: "a".repeat(1001) }, { body: 1 }, {}, null, undefined, "x", []]) {
      assert.equal(validateCommentInput(input).ok, false, JSON.stringify(input));
    }
  });

  it("counts length after trimming", () => {
    assert.equal(validateCommentInput({ body: ` ${"a".repeat(1000)} ` }).ok, true);
  });
});

describe("createComment / listComments", () => {
  it("stores the author and an ISO 8601 UTC timestamp, and lists oldest first", () => {
    const db = openDb();
    const first = createComment({ taskId: 1, author: "sato", body: "一つ目" }, db, new Date("2026-11-09T03:04:05.000Z"));
    createComment({ taskId: 1, author: "suzuki", body: "二つ目" }, db, new Date("2026-11-09T03:05:00.000Z"));
    createComment({ taskId: 2, author: "tanaka", body: "別のタスク" }, db);
    assert.deepEqual(first, {
      id: first.id,
      taskId: 1,
      author: "sato",
      authorName: "佐藤",
      body: "一つ目",
      createdAt: "2026-11-09T03:04:05.000Z",
    });
    assert.deepEqual(listComments(1, db).map((c) => c.body), ["一つ目", "二つ目"]);
    assert.deepEqual(listComments(3, db), []);
  });

  it("keeps SQL-looking text as plain data", () => {
    const db = openDb();
    createComment({ taskId: 1, author: "sato", body: "'); DROP TABLE comments; --" }, db);
    assert.equal(listComments(1, db)[0].body, "'); DROP TABLE comments; --");
  });
});

describe("deleteComment", () => {
  it("lets only the author delete", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "x" }, db);
    assert.equal(deleteComment(1, c.id, "suzuki", db), "forbidden");
    assert.equal(listComments(1, db).length, 1);
    assert.equal(deleteComment(1, c.id, "sato", db), "deleted");
    assert.equal(listComments(1, db).length, 0);
  });

  it("returns not_found for a missing comment or one on another task", () => {
    const db = openDb();
    const c = createComment({ taskId: 1, author: "sato", body: "x" }, db);
    assert.equal(deleteComment(1, 999, "sato", db), "not_found");
    assert.equal(deleteComment(2, c.id, "sato", db), "not_found");
    assert.equal(listComments(1, db).length, 1);
  });
});
