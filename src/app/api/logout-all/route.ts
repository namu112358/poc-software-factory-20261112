// POST /api/logout-all — ログイン中の利用者のセッションを（ほかの端末のものも）すべて削除し、ログイン画面へ戻る。
// 成功時の返し方は POST /api/logout と同じ。未ログインなら 401。
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { SESSION_COOKIE, logoutAllDevices } from "@/lib/auth";

export async function POST(request: Request) {
  const store = await cookies();
  const user = logoutAllDevices(store.get(SESSION_COOKIE)?.value);
  if (!user) return jsonError(401, "ログインしてください");
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
