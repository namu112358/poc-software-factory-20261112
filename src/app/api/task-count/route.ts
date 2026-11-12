// GET /api/task-count — ステータスごとのタスク数を { todo, in_progress, done } で返す。アーカイブしたタスクは数えない。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { countTasksByStatus } from "@/lib/task-count";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json(countTasksByStatus());
}
