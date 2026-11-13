// POST /api/users/:id/suspension — 利用者のログインを停止する / DELETE /api/users/:id/suspension — 再開する（#522）。
// 取りまとめる人だけが使える。未ログインは 401、取りまとめる人でなければ 403、利用者がいなければ 404、
// 自分自身は 400。成功したら { user: { id, name, suspended } } を返す。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { resumeUser, suspendUser, SUSPENSION_REFUSAL_MESSAGES, type SuspensionResult } from "@/lib/users";

type Context = { params: Promise<{ id: string }> };

const STATUS = { forbidden: 403, not_found: 404, self: 400 } as const;

function respond(result: SuspensionResult): NextResponse {
  if (result.ok) return NextResponse.json({ user: result.user });
  return jsonError(STATUS[result.reason], SUSPENSION_REFUSAL_MESSAGES[result.reason]);
}

export async function POST(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return respond(suspendUser(user.id, (await params).id));
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return respond(resumeUser(user.id, (await params).id));
}
