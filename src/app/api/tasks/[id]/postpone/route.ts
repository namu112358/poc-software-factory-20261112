// POST /api/tasks/:id/postpone — タスクの期限を 7 日後ろにずらす。ログインが必要。完了したタスクは 409。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { postponeTask } from "@/lib/postpone";
import { parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  if (id === undefined) return jsonError(404, "タスクが見つかりません");
  const result = postponeTask(id);
  if (result.ok) return NextResponse.json({ task: result.task });
  return result.reason === "done"
    ? jsonError(409, "完了したタスクの期限はずらせません")
    : jsonError(404, "タスクが見つかりません");
}
