// GET /api/runtime — サーバーが動いている Node の版（process.version）を返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ node: process.version }, { headers: { "Cache-Control": "private, no-store" } });
}
