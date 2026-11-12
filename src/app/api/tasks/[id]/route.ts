// GET /api/tasks/:id — タスクを 1 件取得 / PATCH /api/tasks/:id — 送った項目だけを更新する。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { getTask, parseTaskId, updateTask, validateTaskInput } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  const task = id === undefined ? undefined : getTask(id);
  return task ? NextResponse.json({ task }) : jsonError(404, "タスクが見つかりません");
}

export async function PATCH(request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  const result = validateTaskInput(await readJson(request), { partial: true });
  if (!result.ok) return jsonError(400, "入力内容に誤りがあります", result.errors);
  return NextResponse.json({ task: updateTask(id, result.value) });
}
