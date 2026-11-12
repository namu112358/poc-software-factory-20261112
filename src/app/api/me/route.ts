// GET /api/me — ログイン中のユーザー（ID と名前）を返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { toMeResponse } from "@/lib/me";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  // 人ごとに異なる応答なので、共有のキャッシュに残さない。
  return NextResponse.json(toMeResponse(user), { headers: { "Cache-Control": "private, no-store" } });
}
