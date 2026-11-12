// POST /api/tasks/:id/extensions/:extensionId/approve — 延長申請を承認する。ログインが必要。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { decideExtension } from "@/lib/extensions";
import { getTask, parseTaskId } from "@/lib/tasks";

type Context = { params: Promise<{ id: string; extensionId: string }> };

export async function POST(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const { id: rawId, extensionId: rawExtensionId } = await params;
  const id = parseTaskId(rawId);
  if (id === undefined || !getTask(id)) return jsonError(404, "タスクが見つかりません");
  const extensionId = parseTaskId(rawExtensionId);
  if (extensionId === undefined) return jsonError(404, "延長申請が見つかりません");
  const outcome = decideExtension(id, extensionId, "approved", user.id);
  if (outcome.result === "not_found") return jsonError(404, "延長申請が見つかりません");
  if (outcome.result === "conflict") return jsonError(409, "この延長申請はすでに判断されています");
  return NextResponse.json(
    { extension: outcome.extension, task: outcome.task },
  );
}
