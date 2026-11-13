// GET /api/tasks/:id — タスクを 1 件取得 / PATCH /api/tasks/:id — 送った項目だけを更新する / DELETE /api/tasks/:id — タスクを消す（担当者だけ）。ログインが必要。
// PATCH でログインを停止した利用者へ担当者を変えようとしたときは 400 を返す（#522）。
// PATCH で担当者が変わったときは、ログイン中の利用者を変更した人として履歴に残す（GET の応答には履歴を含めない）。
// PATCH の本文に expectedUpdatedAt（編集を始めたときの更新日時）があれば、ほかの人が先に更新していたときは変えずに 409 を返す。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { deleteTask, getTask, parseExpectedUpdatedAt, parseTaskId, updateTask, updateTaskIfUnchanged, validateTaskInput } from "@/lib/tasks";

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
  const current = id === undefined ? undefined : getTask(id);
  if (id === undefined || !current) return jsonError(404, "タスクが見つかりません");
  const body = await readJson(request);
  // 今の担当者をそのまま送ったときは、その人がログインを停止していても通す（担当を変えずにほかの項目を直せるように。#522）
  const result = validateTaskInput(body, { partial: true, currentAssignee: current.assignee });
  const expected = parseExpectedUpdatedAt(body);
  if (!result.ok || !expected.ok) {
    const errors = [...(result.ok ? [] : result.errors), ...(expected.ok ? [] : expected.errors)];
    return jsonError(400, "入力内容に誤りがあります", errors);
  }
  if (expected.value === undefined) return NextResponse.json({ task: updateTask(id, result.value, undefined, user.id) });
  const updated = updateTaskIfUnchanged(id, result.value, expected.value, undefined, user.id);
  if (updated.ok) return NextResponse.json({ task: updated.task });
  if (updated.reason === "not_found") return jsonError(404, "タスクが見つかりません");
  return NextResponse.json(
    { error: "ほかの人が先にこのタスクを更新しました。最新の内容を確かめてから、もう一度保存してください", task: updated.task },
    { status: 409 },
  );
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  const result = id === undefined ? "not_found" : deleteTask(id, user.id);
  if (result === "not_found") return jsonError(404, "タスクが見つかりません");
  if (result === "forbidden") return jsonError(403, "このタスクを削除できるのは担当者だけです");
  return NextResponse.json({ ok: true });
}
