// GET /api/now — サーバーの今の時刻（UTC・ISO 8601）を返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  // 呼ぶたびに変わる値なので、キャッシュに残さない。
  return NextResponse.json({ now: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}
