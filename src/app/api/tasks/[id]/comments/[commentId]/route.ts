// PATCH /api/tasks/:id/comments/:commentId — コメントの本文を編集する / DELETE — コメントを削除する。どちらも投稿者本人のみ。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { deleteComment, getComment, updateComment, validateCommentInput } from "@/lib/comments";
import { getTask, parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string; commentId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const { id: rawId, commentId: rawCommentId } = await params;
  const id = parseTaskId(rawId);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  const commentId = parseTaskId(rawCommentId);
  if (commentId === undefined) return jsonError(404, "コメントが見つかりません");
  // 本文の誤りより先に、対象の有無と権限を返す（他人のコメントには、本文に関係なく 403）。
  const current = getComment(commentId);
  if (!current || current.taskId !== id) return jsonError(404, "コメントが見つかりません");
  if (current.author !== user.id) return jsonError(403, "他の人のコメントは編集できません");
  const input = validateCommentInput(await readJson(request));
  if (!input.ok) return jsonError(400, "入力内容に誤りがあります", input.errors);
  const result = updateComment(id, commentId, user.id, input.value.body);
  if (result.status === "not_found") return jsonError(404, "コメントが見つかりません");
  if (result.status === "forbidden") return jsonError(403, "他の人のコメントは編集できません");
  return NextResponse.json({ comment: result.comment });
}

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
