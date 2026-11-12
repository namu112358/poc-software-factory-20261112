// GET /api/request-id — 呼ぶたびに違う UUID を返す。未ログインなら 401。
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  // 呼ぶたびに値が変わるので、キャッシュに残さない。
  return NextResponse.json({ id: randomUUID() }, { headers: { "Cache-Control": "private, no-store" } });
}
