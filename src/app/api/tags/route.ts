// GET /api/tags — 使われているタグと件数の一覧。ログインが必要。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { listTagCounts } from "@/lib/tags";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ tags: listTagCounts() });
}
