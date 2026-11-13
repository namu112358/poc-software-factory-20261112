// API Route 共通の処理（認証の確認とエラー応答）。
import { NextResponse } from "next/server";
import { IDEMPOTENCY_CONFLICT_MESSAGE, type IdempotentResult } from "./idempotency.ts";
import { getCurrentUser } from "./session.ts";
import { PASSWORD_CHANGE_REQUIRED_DETAIL, PASSWORD_CHANGE_REQUIRED_MESSAGE, mustChangePassword, type User } from "./users.ts";

export function jsonError(status: number, message: string, details?: string[]): NextResponse {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status });
}

/** 仮のパスワードの間（#523）に API を断る応答（403 と理由）。 */
export function passwordChangeRequiredError(): NextResponse {
  return jsonError(403, PASSWORD_CHANGE_REQUIRED_MESSAGE, [PASSWORD_CHANGE_REQUIRED_DETAIL]);
}

/**
 * ログイン中のユーザーを返す。未ログインなら 401 の応答を返す。
 * 仮のパスワードのまま（#523）なら 403 を返す。パスワードの変更の API だけは allowPasswordChangePending で通す。
 */
export async function requireApiUser(
  options: { allowPasswordChangePending?: boolean } = {},
): Promise<User | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "ログインしてください");
  if (!options.allowPasswordChangePending && mustChangePassword(user.id)) return passwordChangeRequiredError();
  return user;
}

/** リクエスト本文を JSON として読む。読めなければ undefined。 */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** キーつきの作成の結果を応答にする。同じキーで本文が違えば 409、それ以外は作った（または 1 回目の）状態と本文（#528）。 */
export function idempotentResponse<T>(result: IdempotentResult<T>): NextResponse {
  if (result.kind === "conflict") return jsonError(409, IDEMPOTENCY_CONFLICT_MESSAGE);
  return NextResponse.json(result.body, { status: result.status });
}
