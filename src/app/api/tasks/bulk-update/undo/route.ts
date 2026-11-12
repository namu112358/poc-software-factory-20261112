// POST /api/tasks/bulk-update/undo — まとめて変えた担当者・ステータスを元に戻す（変えた本人だけ。変えてから 10 分のあいだ、1 回だけ）。ログインが必要。
// 本文は { id }（まとめて変えたときの応答の undo.id）。変えた後にほかの変更があったタスクは戻さず、skippedIds で返す。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { BULK_UNDO_MINUTES, undoBulkUpdate, validateBulkUndoInput } from "@/lib/bulk-undo";

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const input = validateBulkUndoInput(await readJson(request));
  if (!input.ok) return jsonError(400, "入力内容に誤りがあります", input.errors);
  const result = undoBulkUpdate(input.value.id, user.id);
  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return jsonError(404, "元に戻す変更が見つかりません");
      case "forbidden":
        return jsonError(403, "元に戻せるのは、まとめて変えた本人だけです");
      case "already_undone":
        return jsonError(409, "この変更はもう元に戻しています");
      case "expired":
        return jsonError(409, `変えてから ${BULK_UNDO_MINUTES} 分を過ぎたため、元に戻せません`);
    }
  }
  return NextResponse.json({ restoredIds: result.restoredIds, skippedIds: result.skippedIds });
}
