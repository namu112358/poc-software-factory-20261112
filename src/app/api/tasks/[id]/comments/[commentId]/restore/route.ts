// POST /api/tasks/:id/comments/:commentId/restore — 削除したコメントを元に戻す（書いた本人だけ。削除してから 30 日のあいだ）。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { restoreComment } from "@/lib/comments";
import { getTask, parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string; commentId: string }> };

export async function POST(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const { id: rawId, commentId: rawCommentId } = await params;
  const id = parseTaskId(rawId);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  const commentId = parseTaskId(rawCommentId);
  if (commentId === undefined) return jsonError(404, "元に戻せる削除済みのコメントが見つかりません");
  const result = restoreComment(id, commentId, user.id);
  if (result.status === "not_found") return jsonError(404, "元に戻せる削除済みのコメントが見つかりません");
  if (result.status === "forbidden") return jsonError(403, "このコメントを元に戻せるのは書いた本人だけです");
  return NextResponse.json({ comment: result.comment });
}
