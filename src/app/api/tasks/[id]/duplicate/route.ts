// POST /api/tasks/:id/duplicate — タスクを複製する。ログインが必要。
// 元のタスクの担当者がログインを停止していれば、複製せずに 400 を返す（#522）。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { duplicateTaskForRequest, parseTaskId, SUSPENDED_ASSIGNEE_ERROR } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  if (id === undefined) return jsonError(404, "タスクが見つかりません");
  const result = duplicateTaskForRequest(id);
  if (result.ok) return NextResponse.json({ task: result.task }, { status: 201 });
  if (result.reason === "suspended_assignee") {
    return jsonError(400, "入力内容に誤りがあります", [SUSPENDED_ASSIGNEE_ERROR]);
  }
  return jsonError(404, "タスクが見つかりません");
}
