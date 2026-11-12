// POST /api/login — JSON（{ userId, password }）またはフォーム送信でログインする。
// フォーム送信のときは画面遷移（303）、JSON のときは JSON で応答する。
import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api";
import { SESSION_COOKIE, SESSION_TTL_MS, login } from "@/lib/auth";

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
  if (!result.ok && result.reason === "locked") {
    return isJson
      ? jsonError(429, "ログインに続けて失敗したため、しばらくログインできません", [
          `あと ${result.retryAfterMinutes} 分後に試せます`,
        ])
      : NextResponse.redirect(new URL("/login?error=locked", request.url), 303);
  }
  if (!result.ok) {
    return isJson
      ? jsonError(401, "ID またはパスワードが正しくありません")
      : NextResponse.redirect(new URL("/login?error=1", request.url), 303);
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
