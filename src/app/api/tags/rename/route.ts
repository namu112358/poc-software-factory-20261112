// POST /api/tags/rename — タグの名前を、付いているすべてのタスクでまとめて付け替える。ログインが必要。
// 入力に誤りがあれば 400、`from` の付いたタスクが無ければ 404 を返し、どちらもどのタスクも変えない。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { renameTag, validateTagRenameInput } from "@/lib/tags";

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const input = validateTagRenameInput(await readJson(request));
  if (!input.ok) return jsonError(400, "入力内容に誤りがあります", input.errors);
  const { from, to } = input.value;
  const result = renameTag(from, to);
  if (!result.ok) return jsonError(404, "そのタグが付いたタスクはありません");
  return NextResponse.json({ from, to, count: result.count });
}
