// GET /api/server-time — サーバーの現在時刻（UTC・ISO 8601）と、日本時間の今日の日付（YYYY-MM-DD）を返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { todayInJapan } from "@/lib/tasks";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  // 期限切れの判定（isOverdue）と同じ todayInJapan で「今日」を決める。
  const now = new Date();
  // 呼ぶたびに変わる値なので、キャッシュに残さない。
  return NextResponse.json(
    { now: now.toISOString(), today: todayInJapan(now) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
