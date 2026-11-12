// GET /api/tasks?status=…&assignee=…&tag=…&sort=… — タスク一覧 / POST /api/tasks — タスクを作成する。いずれもログインが必要。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { listTasksByQuery } from "@/lib/task-query";
import { createTask, validateTaskInput, type TaskInput } from "@/lib/tasks";

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ tasks: listTasksByQuery(new URL(request.url).searchParams) });
}

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const result = validateTaskInput(await readJson(request));
  if (!result.ok) return jsonError(400, "入力内容に誤りがあります", result.errors);
  return NextResponse.json({ task: createTask(result.value as TaskInput) }, { status: 201 });
}
