// GET /api/sessions — ログイン中の利用者の、有効なセッション（ログイン中の端末）の一覧。
// ログインした日時の新しい順。トークンは返さず、切るときに使う端末の ID を返す。未ログインなら 401。
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth";
import { listDeviceSessions } from "@/lib/device-sessions";

export async function GET() {
  const store = await cookies();
  const sessions = listDeviceSessions(store.get(SESSION_COOKIE)?.value);
  if (!sessions) return jsonError(401, "ログインしてください");
  return NextResponse.json({ sessions });
}
