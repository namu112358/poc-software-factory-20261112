// GET /api/tasks?status=…&assignee=…(複数可)&tag=…(複数可)&due=…&q=…&sort=…&archived=include — タスク一覧 / POST /api/tasks — タスクを作成する。いずれもログインが必要。
// POST に Idempotency-Key ヘッダーを付けると、同じキーの送り直しでは作らずに 1 回目の応答を返す（#528。src/lib/idempotency.ts）。
import { NextResponse } from "next/server";
import { idempotentResponse, jsonError, readJson, requireApiUser } from "@/lib/api";
import { createTaskOnce, IDEMPOTENCY_KEY_HEADER, parseIdempotencyKey } from "@/lib/idempotency";
import { listTasksByQuery } from "@/lib/task-query";
import { validateTaskInput, type TaskInput } from "@/lib/tasks";

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ tasks: listTasksByQuery(new URL(request.url).searchParams) });
}

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const key = parseIdempotencyKey(request.headers.get(IDEMPOTENCY_KEY_HEADER));
  const body = await readJson(request);
  const result = validateTaskInput(body);
  if (!key.ok || !result.ok) {
    return jsonError(400, "入力内容に誤りがあります", [...(key.ok ? [] : key.errors), ...(result.ok ? [] : result.errors)]);
  }
  return idempotentResponse(createTaskOnce(user.id, key.value, body, result.value as TaskInput));
}
