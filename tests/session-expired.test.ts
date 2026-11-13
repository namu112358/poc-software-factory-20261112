import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AFTER_LOGIN_PATH,
  RELOGIN_LINK_LABEL,
  SESSION_EXPIRED_MESSAGE,
  afterLoginPath,
  isSessionExpired,
  loginPath,
  readFormFailure,
  reloginHref,
  safeNextPath,
} from "../src/lib/session-expired.ts";
import { loginErrorPath } from "../src/lib/login-error.ts";
import { confirmAndBulkUpdate, requestBulkUndo } from "../src/lib/bulk-select.ts";
import { submitExtensionRequest } from "../src/lib/task-extension-panel.ts";
import { saveTaskEdit } from "../src/lib/task-edit.ts";
import { passwordErrorMessages } from "../src/lib/password-form.ts";

// 入力の途中でログインが切れても、入力を失わずにログインし直して続けられるようにする（#491）。

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("ログインし直した後の戻り先（オープンリダイレクトにしない）", () => {
  it("このアプリの中の画面は、クエリ・# も含めてそのまま戻り先にする", () => {
    assert.equal(safeNextPath("/tasks/12"), "/tasks/12");
    assert.equal(safeNextPath("/tasks/new"), "/tasks/new");
    assert.equal(safeNextPath("/tasks?status=todo&tag=a"), "/tasks?status=todo&tag=a");
    assert.equal(safeNextPath("/settings/password#form"), "/settings/password#form");
    assert.equal(safeNextPath("/"), "/");
  });

  it("外のサイト・// や /\\ で始まる値・スキーム付きの値は受け付けない", () => {
    for (const value of [
      "https://evil.example/",
      "http://evil.example",
      "//evil.example",
      "//evil.example/tasks",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "\\/evil.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "tasks/12",
      "evil.example",
    ]) {
      assert.equal(safeNextPath(value), undefined, value);
      assert.equal(afterLoginPath(value), DEFAULT_AFTER_LOGIN_PATH, value);
    }
  });

  it("制御文字・バックスラッシュを含む値は受け付けない（ブラウザが取り除いて // になることがあるため）", () => {
    for (const value of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\u0000/evil.example", "/tasks\\..\\x", "/\u007f/evil"]) {
      assert.equal(safeNextPath(value), undefined, JSON.stringify(value));
    }
  });

  it("空・文字列でない値（配列など）・長すぎる値は「指定なし」としてタスク一覧へ", () => {
    for (const value of ["", undefined, null, 1, ["/tasks/1"], { path: "/tasks/1" }, `/${"a".repeat(2000)}`]) {
      assert.equal(safeNextPath(value), undefined);
      assert.equal(afterLoginPath(value), "/tasks");
    }
  });

  it("ログイン画面自身は戻り先にしない（ログインした後にログイン画面へ戻り続けないように）", () => {
    assert.equal(safeNextPath("/login"), undefined);
    assert.equal(safeNextPath("/login?next=/tasks/1"), undefined);
    assert.equal(safeNextPath("/login/"), undefined);
    assert.equal(safeNextPath("/logins"), "/logins");
  });

  it("パスに .. があっても、アプリの中のパスに正規化され、外へは出ない", () => {
    assert.equal(safeNextPath("/tasks/../settings"), "/settings");
    assert.equal(safeNextPath("/../../evil.example"), "/evil.example");
  });
});

describe("ログインし直すリンク", () => {
  it("今いる画面（パス・クエリ・#）へ戻るログイン画面の URL を作り、ログイン後はその画面に戻る", () => {
    // ブラウザの location.search は、日本語を %XX にした形で持つ。
    const search = `?status=todo&tag=${encodeURIComponent("急ぎ")}`;
    const href = reloginHref({ pathname: "/tasks", search, hash: "#t3" });
    assert.ok(href.startsWith("/login?next="));
    const next = new URL(href, "http://localhost").searchParams.get("next");
    assert.equal(next, `/tasks${search}#t3`);
    assert.equal(afterLoginPath(next), `/tasks${search}#t3`);
  });

  it("タスクの詳細・新しいタスク・設定の画面からも、その画面へ戻る（タスク一覧ではなく）", () => {
    for (const pathname of ["/tasks/5", "/tasks/new", "/settings/absence", "/settings/password"]) {
      const next = new URL(reloginHref({ pathname, search: "" }), "http://localhost").searchParams.get("next");
      assert.equal(afterLoginPath(next), pathname);
    }
  });

  it("戻り先が正しくなければ next を付けない", () => {
    assert.equal(loginPath("//evil.example"), "/login");
    assert.equal(loginPath(undefined), "/login");
  });

  it("文言: ログインが切れたことと、新しいタブで開くので入力が残ることが分かる", () => {
    assert.match(SESSION_EXPIRED_MESSAGE, /ログインが切れました/);
    assert.match(SESSION_EXPIRED_MESSAGE, /入力/);
    assert.match(RELOGIN_LINK_LABEL, /ログインし直す/);
    assert.match(RELOGIN_LINK_LABEL, /新しいタブ/);
  });
});

describe("ログインに失敗してログイン画面に戻るときも、戻り先を保つ", () => {
  it("ID・パスワードの誤り・ロックのどれでも next を残す", () => {
    const check = (path: string, error: string) => {
      const q = new URL(path, "http://localhost").searchParams;
      assert.equal(q.get("error"), error);
      assert.equal(q.get("next"), "/tasks/5?x=1");
    };
    check(loginErrorPath({ reason: "invalid" }, "/tasks/5?x=1"), "1");
    check(loginErrorPath({ reason: "locked", retryAfterMinutes: 3 }, "/tasks/5?x=1"), "locked");
    check(loginErrorPath({ reason: "lock-started", retryAfterMinutes: 15 }, "/tasks/5?x=1"), "lock-started");
  });

  it("外のサイトの next は渡さない。next が無ければ今までと同じ URL", () => {
    assert.equal(loginErrorPath({ reason: "invalid" }, "https://evil.example"), "/login?error=1");
    assert.equal(loginErrorPath({ reason: "invalid" }, "//evil.example"), "/login?error=1");
    assert.equal(loginErrorPath({ reason: "invalid" }), "/login?error=1");
    assert.equal(loginErrorPath({ reason: "locked", retryAfterMinutes: 15 }), "/login?error=locked&minutes=15");
  });
});

describe("送った応答の読み分け（コメント・タグ・休みのフォーム）", () => {
  it("401 だけをログイン切れにする", () => {
    assert.equal(isSessionExpired(401), true);
    for (const status of [0, 400, 403, 404, 409, 429, 500]) assert.equal(isSessionExpired(status), false, String(status));
    assert.deepEqual(readFormFailure(401, { error: "ログインしてください" }, "失敗"), { expired: true });
  });

  it("ログインが切れていないときの誤りの表示は今までどおり（details → error → 決まった文の順）", () => {
    assert.deepEqual(readFormFailure(400, { error: "入力内容に誤りがあります", details: ["本文を入力してください"] }, "失敗"), {
      expired: false,
      messages: ["本文を入力してください"],
    });
    assert.deepEqual(readFormFailure(404, { error: "タスクが見つかりません" }, "失敗"), { expired: false, messages: ["タスクが見つかりません"] });
    assert.deepEqual(readFormFailure(409, { error: "重なっています" }, "失敗"), { expired: false, messages: ["重なっています"] });
    assert.deepEqual(readFormFailure(429, { error: "しばらく待って", details: ["あと 3 分"] }, "失敗"), { expired: false, messages: ["あと 3 分"] });
    assert.deepEqual(readFormFailure(500, undefined, "失敗"), { expired: false, messages: ["失敗"] });
    assert.deepEqual(readFormFailure(400, { error: "", details: [1, null] }, "失敗"), { expired: false, messages: ["失敗"] });
  });
});

describe("フォームごとの 401 の扱い", () => {
  const values = { title: "t", status: "todo", assignee: "sato", dueDate: "2026-11-20", priority: "medium", memo: "" } as const;

  it("タスクの編集の保存: 401 は unauthorized（画面はフォームを開いたまま案内を出す）、409・400 は今までどおり", async () => {
    const r = await saveTaskEdit(1, values, "2026-11-13T00:00:00.000Z", { fetch: async () => res(401, { error: "ログインしてください" }) });
    assert.deepEqual(r, { status: "unauthorized" });
    const bad = await saveTaskEdit(1, values, "2026-11-13T00:00:00.000Z", {
      fetch: async () => res(400, { error: "入力内容に誤りがあります", details: ["タイトルを入力してください"] }),
    });
    assert.deepEqual(bad, { status: "invalid", messages: ["タイトルを入力してください"] });
  });

  it("まとめての変更: 401 は expired。何も変えていないことを添え、ほかの誤りとは分ける", async () => {
    const users = [{ id: "sato", name: "佐藤" }];
    const r = await confirmAndBulkUpdate([1, 2], { assignee: "sato", status: "" }, users, {
      confirm: () => true,
      fetch: async () => res(401, { error: "ログインしてください" }),
    });
    assert.deepEqual(r, { status: "expired", message: "1 件も変更していません。" });
    const notFound = await confirmAndBulkUpdate([1, 2], { assignee: "sato", status: "" }, users, {
      confirm: () => true,
      fetch: async () => res(404, { error: "見つかりません" }),
    });
    assert.equal(notFound.status, "error");
  });

  it("まとめての変更を元に戻す: 401 は expired（元に戻すボタンを残す）、ほかの断りは今までどおり error", async () => {
    assert.deepEqual(await requestBulkUndo(3, { fetch: async () => res(401, { error: "ログインしてください" }) }), {
      status: "expired",
      message: "まだ元に戻していません。",
    });
    assert.deepEqual(await requestBulkUndo(3, { fetch: async () => res(409, { error: "期間を過ぎました" }) }), {
      status: "error",
      message: "期間を過ぎました",
    });
  });

  it("期限の延長の申請: 401 は expired、409・400 は今までどおりの文", async () => {
    const send = (status: number, body: unknown) =>
      submitExtensionRequest(3, { newDueDate: "2026-11-20", reason: "待ち" }, "2026-11-15", { fetch: async () => res(status, body) });
    assert.deepEqual(await send(401, { error: "ログインしてください" }), { status: "expired" });
    assert.deepEqual(await send(409, { error: "x" }), { status: "error", message: "承認待ちの申請がすでにあります。" });
    assert.deepEqual(await send(400, { error: "e", details: ["誤り"] }), { status: "error", message: "誤り" });
  });

  it("パスワードの変更: 今のパスワードの誤りは 400 なので、ログイン切れとは扱わない", () => {
    assert.equal(isSessionExpired(400), false);
    assert.deepEqual(passwordErrorMessages({ error: "入力内容に誤りがあります", details: ["今のパスワードが正しくありません"] }), [
      "今のパスワードが正しくありません",
    ]);
  });
});
