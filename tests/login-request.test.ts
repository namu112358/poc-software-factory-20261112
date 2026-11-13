import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { login } from "../src/lib/auth.ts";
import { openDb } from "../src/lib/db/index.ts";
import { MAX_FAILURES, getLockState, recordFailure } from "../src/lib/login-throttle.ts";
import { loginBodyKind, readLoginRequest } from "../src/lib/login-request.ts";

const URL_ = "http://localhost/api/login";
const credentials = JSON.stringify({ userId: "sato", password: "password" });
const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request(URL_, { method: "POST", body, headers });
/** Request は文字列の本文に text/plain を自動で付けるので、ヘッダーを消して「付けない」送り方を作る。 */
const postWithoutContentType = (body: string | null) => {
  const request = post(body);
  request.headers.delete("content-type");
  return request;
};

/** ルートと同じ順で、読めたときだけ login() を呼ぶ。 */
async function handle(request: Request, db: ReturnType<typeof openDb>, now: Date) {
  const body = await readLoginRequest(request);
  if (!body.ok) return { status: body.status, error: body.error, details: body.details };
  return { result: login(body.userId, body.password, db, now) };
}

function assertErrorShape(value: { error?: unknown; details?: unknown }) {
  assert.equal(typeof value.error, "string");
  assert.ok((value.error as string).length > 0);
  assert.ok(Array.isArray(value.details) && value.details.every((d) => typeof d === "string"));
}

describe("ログインの API: JSON でもフォームでもない送り方は 4xx の理由を返す（#513）", () => {
  it("Content-Type を付けず、本文が JSON のときは 415 で { error, details }", async () => {
    const body = await readLoginRequest(postWithoutContentType(credentials));
    assert.equal(body.ok, false);
    if (body.ok) return;
    assert.equal(body.status, 415);
    assertErrorShape(body);
  });

  it("Content-Type を付けず、本文も無いときも 415", async () => {
    const body = await readLoginRequest(postWithoutContentType(null));
    assert.equal(body.ok, false);
    if (body.ok) return;
    assert.equal(body.status, 415);
    assertErrorShape(body);
  });

  it("Content-Type: text/plain のときも 415 で { error, details }", async () => {
    const body = await readLoginRequest(post(credentials, { "content-type": "text/plain" }));
    assert.equal(body.ok, false);
    if (body.ok) return;
    assert.equal(body.status, 415);
    assertErrorShape(body);
    assert.ok(body.details.some((d) => d.includes("application/json")));
  });

  it("フォームの Content-Type なのに本文が読めない（multipart の境界が無い）ときは 500 ではなく 400", async () => {
    const body = await readLoginRequest(post("userId=sato", { "content-type": "multipart/form-data" }));
    assert.equal(body.ok, false);
    if (body.ok) return;
    assert.equal(body.status, 400);
    assertErrorShape(body);
  });
});

describe("読めない送り方は、ログインの判定（誤りの回数・ロック）に入らない", () => {
  const now = new Date("2026-11-13T00:00:00Z");

  it("何度送っても誤りの回数は増えず、ロックされない", async () => {
    const db = openDb();
    for (let i = 0; i < MAX_FAILURES + 1; i++) {
      const res = await handle(post(JSON.stringify({ userId: "sato", password: "wrong" }), { "content-type": "text/plain" }), db, now);
      assert.equal(res.status, 415);
    }
    assert.deepEqual(getLockState("sato", db, now), { locked: false });
    const ok = await handle(post(credentials, { "content-type": "application/json" }), db, now);
    assert.equal(ok.result?.ok, true);
  });

  it("ロック中の利用者でも、読めない送り方には 429 ではなく 415 を返す", async () => {
    const db = openDb();
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("sato", db, now);
    const res = await handle(postWithoutContentType(credentials), db, now);
    assert.equal(res.status, 415);
    assert.equal(res.result, undefined);
  });
});

describe("JSON とフォームのログインは今までどおり読める", () => {
  const now = new Date("2026-11-13T00:00:00Z");

  it("application/json の本文から userId と password を読み、ログインできる", async () => {
    const db = openDb();
    const res = await handle(post(credentials, { "content-type": "application/json; charset=utf-8" }), db, now);
    assert.equal(res.result?.ok, true);
  });

  it("application/x-www-form-urlencoded の本文から userId・password・next を読む", async () => {
    const form = new URLSearchParams({ userId: "sato", password: "password", next: "/tasks?status=todo" });
    const body = await readLoginRequest(post(form));
    assert.deepEqual(body, { ok: true, kind: "form", userId: "sato", password: "password", next: "/tasks?status=todo" });
  });

  it("multipart/form-data の本文から userId と password を読む", async () => {
    const form = new FormData();
    form.set("userId", "sato");
    form.set("password", "password");
    const body = await readLoginRequest(post(form));
    assert.equal(body.ok, true);
    if (!body.ok) return;
    assert.equal(body.kind, "form");
    assert.equal(body.userId, "sato");
    assert.equal(body.password, "password");
    assert.equal(body.next, null);
  });

  it("パスワード違いは今までどおり login() の失敗になり、回数が数えられる", async () => {
    const db = openDb();
    const res = await handle(post(JSON.stringify({ userId: "sato", password: "wrong" }), { "content-type": "application/json" }), db, now);
    assert.deepEqual(res.result, { ok: false, reason: "invalid" });
    for (let i = 1; i < MAX_FAILURES; i++) {
      await handle(post(new URLSearchParams({ userId: "sato", password: "wrong" })), db, now);
    }
    assert.equal(getLockState("sato", db, now).locked, true);
  });

  it("JSON の Content-Type で本文が壊れている・空のときは、今までどおり値なしで login() に進む（401 の扱い）", async () => {
    for (const raw of ["{broken", ""]) {
      const body = await readLoginRequest(post(raw, { "content-type": "application/json" }));
      assert.deepEqual(body, { ok: true, kind: "json", userId: undefined, password: undefined, next: undefined });
    }
  });
});

describe("Content-Type の見分け方", () => {
  it("大文字・小文字と charset などの付加情報を問わない", () => {
    assert.equal(loginBodyKind("Application/JSON"), "json");
    assert.equal(loginBodyKind("application/json;charset=UTF-8"), "json");
    assert.equal(loginBodyKind("APPLICATION/X-WWW-FORM-URLENCODED; charset=utf-8"), "form");
    assert.equal(loginBodyKind("multipart/form-data; boundary=abc"), "form");
  });

  it("無い・空・JSON でもフォームでもないときは undefined", () => {
    assert.equal(loginBodyKind(null), undefined);
    assert.equal(loginBodyKind(""), undefined);
    assert.equal(loginBodyKind("text/plain"), undefined);
    assert.equal(loginBodyKind("application/xml"), undefined);
    assert.equal(loginBodyKind("multipart/mixed; boundary=abc"), undefined);
  });
});
