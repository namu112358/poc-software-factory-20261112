// GET /api/tasks/:id/extensions — 延長申請の一覧 / POST — 延長を申請する。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { createExtension, listExtensions, validateExtensionInput } from "@/lib/extensions";
import { getTask, parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  return NextResponse.json({ extensions: listExtensions(id) });
}

export async function POST(request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  const result = validateExtensionInput(await readJson(request));
  if (!result.ok) return jsonError(400, "入力内容に誤りがあります", result.errors);
  const extension = createExtension({ taskId: id, requester: user.id, ...result.value });
  if (extension === "conflict") return jsonError(409, "保留中の延長申請がすでにあります");
  return NextResponse.json({ extension }, { status: 201 });
}
