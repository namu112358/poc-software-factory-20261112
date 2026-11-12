// GET /api/tasks?status=… — タスク一覧 / POST /api/tasks — タスクを作成する。いずれもログインが必要。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { createTask, isTaskStatus, listTasks, parseTagFilter, validateTaskInput, type TaskInput } from "@/lib/tasks";

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const query = new URL(request.url).searchParams;
  const status = query.get("status");
  const tag = parseTagFilter(query.get("tag"));
  return NextResponse.json({ tasks: listTasks({ status: isTaskStatus(status) ? status : undefined, tag }) });
}

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const result = validateTaskInput(await readJson(request));
  if (!result.ok) return jsonError(400, "入力内容に誤りがあります", result.errors);
  return NextResponse.json({ task: createTask(result.value as TaskInput) }, { status: 201 });
}
