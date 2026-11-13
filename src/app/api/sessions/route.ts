// GET /api/sessions — ログイン中の利用者の、有効なセッション（ログイン中の端末）の一覧。
// ログインした日時の新しい順。トークンは返さず、切るときに使う端末の ID と、最後に使った日時（lastUsedAt）を返す。未ログインなら 401。
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jsonError, passwordChangeRequiredError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { mustChangePassword } from "@/lib/users";
import { SESSION_COOKIE } from "@/lib/auth";
import { listDeviceSessions } from "@/lib/device-sessions";

export async function GET() {
  const store = await cookies();
  // 仮のパスワードの間（#523）は使えない（requireApiUser を通らないため、ここで断る）。
  const current = await getCurrentUser();
  if (current && mustChangePassword(current.id)) return passwordChangeRequiredError();
  const sessions = listDeviceSessions(store.get(SESSION_COOKIE)?.value);
  if (!sessions) return jsonError(401, "ログインしてください");
  return NextResponse.json({ sessions });
}
