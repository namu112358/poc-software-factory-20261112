// GET /api/statuses — タスクのステータスの値と日本語の名前を、画面と同じ順で返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { STATUS_LABELS, TASK_STATUSES } from "@/lib/tasks";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ statuses: TASK_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })) });
}
