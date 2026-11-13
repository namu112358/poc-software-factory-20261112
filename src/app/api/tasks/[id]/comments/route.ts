// GET /api/tasks/:id/comments — コメント一覧 / POST — コメントを投稿する。ログインが必要。
// POST に Idempotency-Key ヘッダーを付けると、同じキーの送り直しでは投稿せずに 1 回目の応答を返す（#528。src/lib/idempotency.ts）。
import { NextResponse } from "next/server";
import { idempotentResponse, jsonError, readJson, requireApiUser } from "@/lib/api";
import { listComments, validateCommentInput } from "@/lib/comments";
import { createCommentOnce, IDEMPOTENCY_KEY_HEADER, parseIdempotencyKey } from "@/lib/idempotency";
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
  const key = parseIdempotencyKey(request.headers.get(IDEMPOTENCY_KEY_HEADER));
  const body = await readJson(request);
  const result = validateCommentInput(body);
  if (!key.ok || !result.ok) {
    return jsonError(400, "入力内容に誤りがあります", [...(key.ok ? [] : key.errors), ...(result.ok ? [] : result.errors)]);
  }
  return idempotentResponse(createCommentOnce(user.id, key.value, id, body, result.value.body));
}
