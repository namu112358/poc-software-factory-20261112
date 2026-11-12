// POST /api/logout — セッションを削除してログイン画面へ戻る。
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, deleteSession } from "@/lib/auth";

export async function POST(request: Request) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
