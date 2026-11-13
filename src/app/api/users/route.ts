// GET /api/users — 利用者の全員（ID・名前・ログインを停止しているか `suspended`）を返す。ログインが必要。
// 担当者の候補（ログインを停止した人を除く）は GET /api/assignees（#522）。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { listUserSummaries } from "@/lib/users";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ users: listUserSummaries() });
}
