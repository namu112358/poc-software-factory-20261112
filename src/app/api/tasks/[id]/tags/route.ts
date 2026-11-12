// GET /api/tasks/:id/tags — タグ一覧 / POST — タグを付ける。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { addTag, listTags, validateTagInput } from "@/lib/tags";
import { getTask, parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  return NextResponse.json({ tags: listTags(id) });
}

export async function POST(request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  const result = validateTagInput(await readJson(request));
  if (!result.ok) return jsonError(400, "入力内容に誤りがあります", result.errors);
  if (addTag(id, result.value.name) === "duplicate") return jsonError(409, "そのタグはすでに付いています");
  return NextResponse.json({ tags: listTags(id) }, { status: 201 });
}
