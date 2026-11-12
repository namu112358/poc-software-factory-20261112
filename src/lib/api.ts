// API Route 共通の処理（認証の確認とエラー応答）。
import { NextResponse } from "next/server";
import { getCurrentUser } from "./session.ts";
import type { User } from "./users.ts";

export function jsonError(status: number, message: string, details?: string[]): NextResponse {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status });
}

/** ログイン中のユーザーを返す。未ログインなら 401 の応答を返す。 */
export async function requireApiUser(): Promise<User | NextResponse> {
  const user = await getCurrentUser();
  return user ?? jsonError(401, "ログインしてください");
}

/** リクエスト本文を JSON として読む。読めなければ undefined。 */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
