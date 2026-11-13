// POST /api/login — JSON（{ userId, password }）またはフォーム送信でログインする。
// フォーム送信のときは画面遷移（303）、JSON のときは JSON で応答する。
// JSON でもフォームでもない送り方は 415、読めないフォームは 400 を JSON で返す（#513）。
// フォーム送信の next（ログインした後の戻り先。#491）は、このアプリの中の画面のときだけ使い、それ以外はタスク一覧へ移す。
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { SESSION_COOKIE, SESSION_TTL_MS, login } from "@/lib/auth";
import { loginErrorPath } from "@/lib/login-error";
import { readLoginRequest } from "@/lib/login-request";
import { afterLoginPath } from "@/lib/session-expired";

export async function POST(request: Request) {
  const body = await readLoginRequest(request);
  // 読めない送り方は、ログインの判定（誤りの回数・ロック）の前に 4xx で返す（#513）
  if (!body.ok) return jsonError(body.status, body.error, body.details);
  const isJson = body.kind === "json";
  const { userId, password, next } = body;

  const result = login(userId, password, undefined, undefined, request.headers.get("user-agent"));
  if (!result.ok) {
    if (!isJson) return NextResponse.redirect(new URL(loginErrorPath(result, next), request.url), 303);
    if (result.reason === "invalid") return jsonError(401, "ID またはパスワードが正しくありません");
    const details = [`あと ${result.retryAfterMinutes} 分後に試せます`];
    return result.reason === "lock-started"
      ? jsonError(429, "ID またはパスワードが正しくありません。続けて失敗したため、ログインをロックしました", details)
      : jsonError(429, "ログインに続けて失敗したため、しばらくログインできません", details);
  }

  const response = isJson
    ? NextResponse.json({ user: result.user })
    : NextResponse.redirect(new URL(afterLoginPath(next), request.url), 303);
  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
