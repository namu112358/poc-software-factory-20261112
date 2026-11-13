// POST /api/users/:id/temporary-password — 取りまとめる人が、メンバーに仮のパスワードを出し直す（#566）。本文は受け付けない。
// 未ログインは 401、取りまとめる人でなければ 403、本文に項目があれば 400、利用者がいなければ 404、自分自身は 400、停止中の人は 409。
// 成功は 201 で { user: { id, name }, temporaryPassword }。仮のパスワードはこの応答にだけ含み、あとから取り出せない。
// 出し直すと、その人の前のパスワードは使えなくなり、ログイン中の端末はすべてログインが切れる。
import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { parseOptionalJson } from "@/lib/body-fields";
import { REISSUE_REFUSAL_MESSAGES, reissueTemporaryPassword } from "@/lib/users";

type Context = { params: Promise<{ id: string }> };

const STATUS = { forbidden: 403, invalid: 400, not_found: 404, self: 400, suspended: 409 } as const;

export async function POST(request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const result = reissueTemporaryPassword(user.id, (await params).id, parseOptionalJson(await request.text().catch(() => "")));
  if (!result.ok) {
    return jsonError(
      STATUS[result.reason],
      REISSUE_REFUSAL_MESSAGES[result.reason],
      result.reason === "invalid" ? result.errors : undefined,
    );
  }
  return NextResponse.json(
    { user: result.user, temporaryPassword: result.temporaryPassword },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

