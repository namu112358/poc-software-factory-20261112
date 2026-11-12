// POST /api/tasks/bulk-complete — 指定したタスクをまとめて完了にする。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { completeTasks, validateBulkCompleteInput } from "@/lib/tasks";

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const input = validateBulkCompleteInput(await readJson(request));
  if (!input.ok) return jsonError(400, "入力内容に誤りがあります", input.errors);
  const result = completeTasks(input.value);
  if (!result.ok) return jsonError(404, "タスクが見つかりません", [`存在しないタスク: ${result.missing.join(", ")}`]);
  return NextResponse.json({ tasks: result.tasks });
}
