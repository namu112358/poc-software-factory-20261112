// DELETE /api/tasks/:id/comments/:commentId — コメントを削除する（投稿者本人のみ）。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { deleteComment } from "@/lib/comments";
import { getTask, parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string; commentId: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const { id: rawId, commentId: rawCommentId } = await params;
  const id = parseTaskId(rawId);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  const commentId = parseTaskId(rawCommentId);
  if (commentId === undefined) return jsonError(404, "コメントが見つかりません");
  const result = deleteComment(id, commentId, user.id);
  if (result === "not_found") return jsonError(404, "コメントが見つかりません");
  if (result === "forbidden") return jsonError(403, "他の人のコメントは削除できません");
  return new NextResponse(null, { status: 204 });
}
