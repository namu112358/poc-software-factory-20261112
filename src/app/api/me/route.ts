// GET /api/me — ログイン中のユーザー（ID と名前）と、ほかの端末での新しいログインの知らせ（loginNotice。無ければ null）を返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { toMeResponse } from "@/lib/me";
import { getCurrentLoginNotice } from "@/lib/session";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const loginNotice = (await getCurrentLoginNotice()) ?? null;
  // 人ごとに異なる応答なので、共有のキャッシュに残さない。
  return NextResponse.json(toMeResponse(user, loginNotice), { headers: { "Cache-Control": "private, no-store" } });
}
