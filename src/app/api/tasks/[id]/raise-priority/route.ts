// POST /api/tasks/:id/raise-priority — タスクの優先度を 1 段上げる。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { raisePriority } from "@/lib/priority-raise";
import { parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const id = parseTaskId((await params).id);
  const result = id === undefined ? undefined : raisePriority(id);
  if (!result || (!result.ok && result.reason === "not_found")) return jsonError(404, "タスクが見つかりません");
  if (!result.ok) return jsonError(409, "優先度はすでに最も高いため、上げられません");
  return NextResponse.json({ task: result.task });
}
