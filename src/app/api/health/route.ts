// GET /api/health — サーバーが応答しているかを確かめる。ログインが必要。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ status: "ok" });
}
