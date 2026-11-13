// GET /api/assignees — 担当者の候補（アプリの利用者の全員の ID と名前）を返す。ログインが必要。
// 担当のタスクの有無によらず、画面の担当者の選択肢と同じ人・同じ並び（利用者の ID 順）を返す（#492）。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { listUserOptions } from "@/lib/users";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ assignees: listUserOptions() });
}
