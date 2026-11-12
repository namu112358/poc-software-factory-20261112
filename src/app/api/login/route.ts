// POST /api/login — JSON（{ userId, password }）またはフォーム送信でログインする。
// フォーム送信のときは画面遷移（303）、JSON のときは JSON で応答する。
import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api";
import { SESSION_COOKIE, SESSION_TTL_MS, authenticate, createSession } from "@/lib/auth";

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

  const user =
    typeof userId === "string" && typeof password === "string" ? authenticate(userId, password) : undefined;
  if (!user) {
    return isJson
      ? jsonError(401, "ID またはパスワードが正しくありません")
      : NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  const response = isJson
    ? NextResponse.json({ user })
    : NextResponse.redirect(new URL("/tasks", request.url), 303);
  response.cookies.set(SESSION_COOKIE, createSession(user.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
