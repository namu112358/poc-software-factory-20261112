// GET /api/tasks/:id/comments — コメント一覧 / POST — コメントを投稿する。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { createComment, listComments, validateCommentInput } from "@/lib/comments";
import { getTask, parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  return NextResponse.json({ comments: listComments(id) });
}

export async function POST(request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  const result = validateCommentInput(await readJson(request));
  if (!result.ok) return jsonError(400, "入力内容に誤りがあります", result.errors);
  const comment = createComment({ taskId: id, author: user.id, body: result.value.body });
  return NextResponse.json({ comment }, { status: 201 });
}
