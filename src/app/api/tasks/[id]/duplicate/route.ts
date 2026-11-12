// POST /api/tasks/:id/duplicate — タスクを複製する。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { duplicateTask, parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  const task = id === undefined ? undefined : duplicateTask(id);
  return task ? NextResponse.json({ task }, { status: 201 }) : jsonError(404, "タスクが見つかりません");
}
