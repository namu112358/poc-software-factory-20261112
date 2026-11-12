// GET /api/time-zone — 日付の判定（期限・今日）に使うタイムゾーンを返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";

// src/lib/tasks.ts の todayInJapan が日付の判定に使うタイムゾーンと同じ値。
const TIME_ZONE = "Asia/Tokyo";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ timeZone: TIME_ZONE });
}
