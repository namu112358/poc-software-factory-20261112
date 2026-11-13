// 作成の API（タスクの作成・コメントの投稿）の Idempotency-Key（#528）。
// 連携スクリプトが通信の途中で切れて同じ作成を送り直しても、同じものが 2 つできないようにする。
// - キーは任意。付けなければ今までどおり毎回作る。
// - 同じ利用者が同じ用途・同じキー・同じ本文で送ると、2 回目は作らずに 1 回目と同じ状態と本文を返す。
// - 同じキーで本文が違えば、何も作らずに断る（conflict）。
// - キーは 24 時間有効。過ぎたら新しい作成として扱う。
// - 成功した応答だけを残す。入力の誤り・対象が無いなどで断った送信は残さないので、直して同じキーで送り直せる。
import { createHash } from "node:crypto";
import { createComment, type Comment } from "./comments.ts";
import { getDb, type Db } from "./db/index.ts";
import { createTask } from "./task-store.ts";
import type { Task, TaskInput, ValidationResult } from "./task-types.ts";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
export const IDEMPOTENCY_TTL_HOURS = 24;

/** キーを使える用途。用途が違えば、同じキーでも別のものとして扱う。 */
export type IdempotencyScope = "tasks.create" | "comments.create";

const KEY_PATTERN = /^[\x21-\x7e]+$/;

/**
 * Idempotency-Key ヘッダーの値を確かめる。ヘッダーが無ければ undefined（キーなし）。
 * 1〜255 文字の、空白を含まない表示できる ASCII だけを受け付ける。
 */
export function parseIdempotencyKey(value: string | null | undefined): ValidationResult<string | undefined> {
  if (value === null || value === undefined) return { ok: true, value: undefined };
  if (value.length < 1 || value.length > IDEMPOTENCY_KEY_MAX_LENGTH || !KEY_PATTERN.test(value)) {
    return {
      ok: false,
      errors: [
        `${IDEMPOTENCY_KEY_HEADER} は 1〜${IDEMPOTENCY_KEY_MAX_LENGTH} 文字の、空白を含まない英数字・記号（ASCII）で指定してください`,
      ],
    };
  }
  return { ok: true, value };
}

/** 項目の順をそろえた JSON。項目の順だけが違う本文は同じものとして扱う。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 送られた内容の指紋（SHA-256）。同じキーで送られた本文が 1 回目と同じかを比べるのに使う。 */
export function requestFingerprint(request: unknown): string {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
}

export type IdempotentResponse<T> = { status: number; body: T };

export type IdempotentResult<T> =
  | { kind: "created"; status: number; body: T }
  | { kind: "replayed"; status: number; body: T }
  | { kind: "conflict" };

export type IdempotentRequest = {
  userId: string;
  scope: IdempotencyScope;
  key: string | undefined;
  fingerprint: string;
};

/** キーの有効期限の境目。これより前（ちょうどを含む）に記録したキーは期限切れ。 */
export function idempotencyCutoff(now: Date): string {
  return new Date(now.getTime() - IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

/**
 * キーつきの作成を 1 回だけ行う。キーが無ければ create をそのまま呼ぶ。
 * キーがあれば、作成とキーの記録を 1 つのトランザクション（BEGIN IMMEDIATE）で行う。
 * create は、作ったものと状態を返す。成功（2xx）でない応答はキーに残さない。
 */
export function runIdempotent<T>(
  request: IdempotentRequest,
  create: () => IdempotentResponse<T>,
  db: Db = getDb(),
  now: Date = new Date(),
): IdempotentResult<T> {
  if (request.key === undefined) return { kind: "created", ...create() };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM idempotency_keys WHERE created_at <= ?").run(idempotencyCutoff(now));
    const stored = db
      .prepare("SELECT fingerprint, response_status, response_body FROM idempotency_keys WHERE user_id = ? AND scope = ? AND key = ?")
      .get(request.userId, request.scope, request.key) as
      | { fingerprint: string; response_status: number; response_body: string }
      | undefined;
    let result: IdempotentResult<T>;
    if (stored) {
      result =
        stored.fingerprint === request.fingerprint
          ? { kind: "replayed", status: Number(stored.response_status), body: JSON.parse(stored.response_body) as T }
          : { kind: "conflict" };
    } else {
      const response = create();
      if (response.status >= 200 && response.status < 300) {
        db.prepare(
          "INSERT INTO idempotency_keys (user_id, scope, key, fingerprint, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(request.userId, request.scope, request.key, request.fingerprint, response.status, JSON.stringify(response.body), now.toISOString());
      }
      result = { kind: "created", ...response };
    }
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 同じキーで本文が違うときの、断りの文言。 */
export const IDEMPOTENCY_CONFLICT_MESSAGE = `この ${IDEMPOTENCY_KEY_HEADER} は、別の内容の送信にすでに使われています。新しい作成には別のキーを使ってください`;

/** POST /api/tasks の作成。rawBody は送られた本文（指紋に使う）、input は検証した後の値。 */
export function createTaskOnce(
  userId: string,
  key: string | undefined,
  rawBody: unknown,
  input: TaskInput,
  db: Db = getDb(),
  now: Date = new Date(),
): IdempotentResult<{ task: Task }> {
  return runIdempotent(
    { userId, scope: "tasks.create", key, fingerprint: requestFingerprint(rawBody) },
    () => ({ status: 201, body: { task: createTask(input, db) } }),
    db,
    now,
  );
}

/** POST /api/tasks/:id/comments の投稿。同じキーでも、別のタスクへの投稿は本文が違うものとして扱う。 */
export function createCommentOnce(
  userId: string,
  key: string | undefined,
  taskId: number,
  rawBody: unknown,
  text: string,
  db: Db = getDb(),
  now: Date = new Date(),
): IdempotentResult<{ comment: Comment }> {
  return runIdempotent(
    { userId, scope: "comments.create", key, fingerprint: requestFingerprint({ taskId, body: rawBody }) },
    () => ({ status: 201, body: { comment: createComment({ taskId, author: userId, body: text }, db, now) } }),
    db,
    now,
  );
}
