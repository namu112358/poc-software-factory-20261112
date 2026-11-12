// GET /api/uptime — サーバーのプロセスが起動してからの秒数（整数）を返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  // 呼ぶたびに値が変わるので、キャッシュに残さない。
  return NextResponse.json({ seconds: Math.floor(process.uptime()) }, { headers: { "Cache-Control": "private, no-store" } });
}
