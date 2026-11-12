// GET /api/priorities — 優先度の値と日本語の名前の一覧（高い順）を返す。ログインが必要。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { PRIORITY_LABELS, TASK_PRIORITIES } from "@/lib/tasks";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({
    priorities: TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] })),
  });
}
