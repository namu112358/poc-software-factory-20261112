// API Route 共通の処理（認証の確認とエラー応答）。
import { NextResponse } from "next/server";
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
