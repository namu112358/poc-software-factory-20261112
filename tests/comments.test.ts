import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/db/index.ts";
import { createComment, deleteComment, listCommentersByTask, listComments, splitCommentBody, validateCommentInput } from "../src/lib/comments.ts";

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

describe("listCommentersByTask", () => {
  it("lists each commenter once, in order of first comment, per task", () => {
    const db = openDb();
    createComment({ taskId: 1, author: "suzuki", body: "a" }, db);
    createComment({ taskId: 1, author: "sato", body: "b" }, db);
    createComment({ taskId: 1, author: "suzuki", body: "c" }, db);
    createComment({ taskId: 2, author: "tanaka", body: "d" }, db);
    const map = listCommentersByTask([1, 2, 3], db);
    const name = (id: string) => (db.prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string }).name;
    assert.deepEqual(map.get(1), [name("suzuki"), name("sato")]);
    assert.deepEqual(map.get(2), [name("tanaka")]);
  });

  it("omits tasks without comments and handles an empty list", () => {
    const db = openDb();
    assert.equal(listCommentersByTask([1], db).has(1), false);
    assert.equal(listCommentersByTask([], db).size, 0);
  });
});

describe("splitCommentBody", () => {
  const text = (t: string) => ({ type: "text", text: t });
  const link = (url: string) => ({ type: "link", url });

  it("turns an http(s) URL into a link and keeps the other text", () => {
    assert.deepEqual(splitCommentBody("資料: https://example.com/a?b=1 を見て"), [
      text("資料: "),
      link("https://example.com/a?b=1"),
      text(" を見て"),
    ]);
    assert.deepEqual(splitCommentBody("http://example.com"), [link("http://example.com")]);
  });

  it("links several URLs and leaves trailing punctuation out of the link", () => {
    assert.deepEqual(splitCommentBody("(https://a.example/x). と https://b.example/y,"), [
      text("("),
      link("https://a.example/x"),
      text("). と "),
      link("https://b.example/y"),
      text(","),
    ]);
  });

  it("stops the URL at Japanese text", () => {
    assert.deepEqual(splitCommentBody("https://example.com/a。次"), [link("https://example.com/a"), text("。次")]);
  });

  it("does not link schemes other than http and https", () => {
    for (const s of ["javascript:alert(1)", "ftp://example.com", "data:text/html,x", "https://", "http:// x"]) {
      assert.ok(splitCommentBody(s).every((p) => p.type === "text"), s);
    }
  });

  it("keeps HTML as plain text and keeps line breaks", () => {
    assert.deepEqual(splitCommentBody("<script>alert(1)</script>\nhttps://example.com/<b>"), [
      text("<script>alert(1)</script>\n"),
      link("https://example.com/"),
      text("<b>"),
    ]);
    const joined = (s: string) => splitCommentBody(s).map((p) => (p.type === "text" ? p.text : p.url)).join("");
    for (const s of ["a\nb\r\nhttps://x.example\n\nc", "", "plain"]) assert.equal(joined(s), s);
  });
});
