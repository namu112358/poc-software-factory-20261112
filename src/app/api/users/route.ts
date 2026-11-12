// GET /api/users — 担当者の候補（利用者の ID と名前の一覧）を返す。ログインが必要。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { listUserOptions } from "@/lib/users";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ users: listUserOptions() });
}
