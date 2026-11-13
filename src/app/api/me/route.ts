// GET /api/me — ログイン中のユーザー（ID と名前と役割 role。役割は #524）と、ほかの端末での新しいログインの知らせ（loginNotice。無ければ null）、
// 前回のログインのあとにロックされた知らせ（lockNotice: { count, lastLockedAt }。無ければ null）を返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { toMeResponse } from "@/lib/me";
import { getCurrentLockNotice, getCurrentLoginNotice } from "@/lib/session";
import { getUserRole } from "@/lib/users";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const loginNotice = (await getCurrentLoginNotice()) ?? null;
  const lockNotice = (await getCurrentLockNotice()) ?? null;
  // 人ごとに異なる応答なので、共有のキャッシュに残さない。
  return NextResponse.json(toMeResponse({ ...user, role: getUserRole(user.id) ?? "member" }, loginNotice, lockNotice), { headers: { "Cache-Control": "private, no-store" } });
}
