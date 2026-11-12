// GET /api/ping — ログインした状態で API が応答するかを確かめる。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ pong: true }, { headers: { "Cache-Control": "private, no-store" } });
}
