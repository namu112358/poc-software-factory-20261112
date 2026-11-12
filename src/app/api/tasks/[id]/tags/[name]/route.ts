// DELETE /api/tasks/:id/tags/:name — タグを外す。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { removeTag } from "@/lib/tags";
import { getTask, parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string; name: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const { id: rawId, name } = await params;
  const id = parseTaskId(rawId);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  if (removeTag(id, name) === "not_found") return jsonError(404, "タグが見つかりません");
  return new NextResponse(null, { status: 204 });
}
