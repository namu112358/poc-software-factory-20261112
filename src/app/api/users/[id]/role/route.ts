// PUT /api/users/:id/role — 取りまとめる人が、利用者の役割を替える（{ "role": "coordinator" | "member" }。#524）。
// 未ログインは 401、取りまとめる人でなければ 403、入力の誤りは 400（details に理由）、利用者がいなければ 404、
// 停止中の人を取りまとめる人にする・取りまとめる人が 1 人もいなくなる変更は 409（error に理由）。
// 成功したら { user: { id, name, role } } を返す。今と同じ役割なら何も変えずに 200。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { changeUserRole, ROLE_CHANGE_REFUSAL_MESSAGES } from "@/lib/users";

type Context = { params: Promise<{ id: string }> };

const STATUS = { forbidden: 403, invalid: 400, not_found: 404, suspended: 409, last_coordinator: 409 } as const;

export async function PUT(request: Request, { params }: Context) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const result = changeUserRole(user.id, (await params).id, await readJson(request));
  if (!result.ok) {
    return jsonError(
      STATUS[result.reason],
      ROLE_CHANGE_REFUSAL_MESSAGES[result.reason],
      result.reason === "invalid" ? result.errors : undefined,
    );
  }
  return NextResponse.json({ user: result.user });
}
