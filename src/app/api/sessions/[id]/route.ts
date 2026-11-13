// DELETE /api/sessions/:id — ログイン中の利用者の、ほかの端末のセッションを 1 つだけ切る。
// 未ログインは 401、本人の有効なセッションに無い ID は 404、今の端末は 400（ログアウトを使う）。
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jsonError, passwordChangeRequiredError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { mustChangePassword } from "@/lib/users";
import { SESSION_COOKIE } from "@/lib/auth";
import { revokeDeviceSession } from "@/lib/device-sessions";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await cookies();
  // 仮のパスワードの間（#523）は使えない（requireApiUser を通らないため、ここで断る）。
  const current = await getCurrentUser();
  if (current && mustChangePassword(current.id)) return passwordChangeRequiredError();
  const result = revokeDeviceSession(store.get(SESSION_COOKIE)?.value, id);
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.reason === "unauthorized") return jsonError(401, "ログインしてください");
  if (result.reason === "current") {
    return jsonError(400, "今使っている端末は切れません", ["この端末からはログアウトを使ってください"]);
  }
  return jsonError(404, "端末が見つかりません");
}
