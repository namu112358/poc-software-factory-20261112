// GET /api/tasks/:id — タスクを 1 件取得 / PATCH /api/tasks/:id — 送った項目だけを更新する。ログインが必要。
// PATCH の本文に expectedUpdatedAt（編集を始めたときの更新日時）があれば、ほかの人が先に更新していたときは変えずに 409 を返す。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { getTask, parseExpectedUpdatedAt, parseTaskId, updateTask, updateTaskIfUnchanged, validateTaskInput } from "@/lib/tasks";

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
  const body = await readJson(request);
  const result = validateTaskInput(body, { partial: true });
  const expected = parseExpectedUpdatedAt(body);
  if (!result.ok || !expected.ok) {
    const errors = [...(result.ok ? [] : result.errors), ...(expected.ok ? [] : expected.errors)];
    return jsonError(400, "入力内容に誤りがあります", errors);
  }
  if (expected.value === undefined) return NextResponse.json({ task: updateTask(id, result.value) });
  const updated = updateTaskIfUnchanged(id, result.value, expected.value);
  if (updated.ok) return NextResponse.json({ task: updated.task });
  if (updated.reason === "not_found") return jsonError(404, "タスクが見つかりません");
  return NextResponse.json(
    { error: "ほかの人が先にこのタスクを更新しました。最新の内容を確かめてから、もう一度保存してください", task: updated.task },
    { status: 409 },
  );
}
