// POST /api/login-notices — ほかの端末での新しいログインの知らせを「確かめた」にする（{ throughId }。知らせの throughId を送る）。
// このセッション（端末）の分だけを消し、ほかの端末の知らせは消さない。入力誤りは 400、未ログインは 401。
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth";
import { acknowledgeLoginNotices, validateAcknowledgeInput } from "@/lib/login-notices";

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const input = validateAcknowledgeInput(await readJson(request));
  if (!input.ok) return jsonError(400, "入力に誤りがあります", input.errors);
  const store = await cookies();
  if (!acknowledgeLoginNotices(store.get(SESSION_COOKIE)?.value, input.value.throughId)) {
    return jsonError(401, "ログインしてください");
  }
  return NextResponse.json({ ok: true });
}
