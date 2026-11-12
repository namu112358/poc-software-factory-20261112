// GET /api/assignees — タスク一覧の担当者の絞り込みに出る人の一覧を返す。ログインが必要。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { listAssignees } from "@/lib/tasks";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ assignees: listAssignees() });
}
