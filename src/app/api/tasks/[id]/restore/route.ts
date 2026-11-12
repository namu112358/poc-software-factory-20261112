// POST /api/tasks/:id/restore — 削除したタスクを元に戻す（担当者だけ。削除してから 30 日のあいだ）。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { getTask, parseTaskId, restoreTask } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  const result = id === undefined ? "not_found" : restoreTask(id, user.id);
  if (result === "not_found") return jsonError(404, "元に戻せる削除済みのタスクが見つかりません");
  if (result === "forbidden") return jsonError(403, "このタスクを元に戻せるのは担当者だけです");
  return NextResponse.json({ task: getTask(id!) });
}
