// POST /api/login — JSON（{ userId, password }）またはフォーム送信でログインする。
// フォーム送信のときは画面遷移（303）、JSON のときは JSON で応答する。
import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api";
import { SESSION_COOKIE, SESSION_TTL_MS, login } from "@/lib/auth";
import { loginErrorPath } from "@/lib/login-error";

export async function POST(request: Request) {
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  let userId: unknown;
  let password: unknown;
  if (isJson) {
    const body = (await readJson(request)) as Record<string, unknown> | undefined;
    userId = body?.userId;
    password = body?.password;
  } else {
    const form = await request.formData();
    userId = form.get("userId");
    password = form.get("password");
  }

  const result = login(userId, password, undefined, undefined, request.headers.get("user-agent"));
  if (!result.ok) {
    if (!isJson) return NextResponse.redirect(new URL(loginErrorPath(result), request.url), 303);
    if (result.reason === "invalid") return jsonError(401, "ID またはパスワードが正しくありません");
    const details = [`あと ${result.retryAfterMinutes} 分後に試せます`];
    return result.reason === "lock-started"
      ? jsonError(429, "ID またはパスワードが正しくありません。続けて失敗したため、ログインをロックしました", details)
      : jsonError(429, "ログインに続けて失敗したため、しばらくログインできません", details);
  }

  const response = isJson
    ? NextResponse.json({ user: result.user })
    : NextResponse.redirect(new URL("/tasks", request.url), 303);
  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
