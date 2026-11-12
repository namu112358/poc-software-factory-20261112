// POST /api/tasks/bulk-update — 指定したタスクのステータス・担当者をまとめて変える。ログインが必要。
// 入力に誤りがあれば 400、存在しない ID が 1 つでもあれば 404 を返し、どちらもどのタスクも変えない。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { updateTasks, validateBulkUpdateInput } from "@/lib/bulk-update";

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const input = validateBulkUpdateInput(await readJson(request));
  if (!input.ok) return jsonError(400, "入力内容に誤りがあります", input.errors);
  const result = updateTasks(input.value.ids, input.value.changes);
  if (!result.ok) {
    return jsonError(404, "タスクが見つかりません", result.missingIds.map((id) => `ID ${id} のタスクが見つかりません`));
  }
  return NextResponse.json({ tasks: result.tasks });
}
