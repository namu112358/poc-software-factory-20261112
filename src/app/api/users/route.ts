// GET /api/users — 利用者の全員（ID・名前・ログインを停止しているか `suspended`・役割 `role`（#524）・仮のパスワードのままか `mustChangePassword`（#566））を返す。ログインが必要。
// 仮のパスワードの出し直しは POST /api/users/:id/temporary-password（#566）。
// 役割の付け替えは PUT /api/users/:id/role（#524）。
// 担当者の候補（ログインを停止した人を除く）は GET /api/assignees（#522）。
// POST /api/users — 取りまとめる人が、メンバーのアカウントを作る（{ userId, name }。#523）。
// 未ログインは 401、取りまとめる人でなければ 403、入力の誤りは 400（details に理由）、ID がすでにある（停止中を含む）なら 409。
// 成功は 201 で { user: { id, name, role }, temporaryPassword }。仮のパスワードはこの応答にだけ含み、あとから取り出せない。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { CREATE_MEMBER_REFUSAL_MESSAGES, createMember, listUserSummaries } from "@/lib/users";

const STATUS = { forbidden: 403, invalid: 400, conflict: 409 } as const;

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ users: listUserSummaries() });
}

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const result = createMember(user.id, await readJson(request));
  if (!result.ok) {
    return jsonError(
      STATUS[result.reason],
      CREATE_MEMBER_REFUSAL_MESSAGES[result.reason],
      result.reason === "invalid" ? result.errors : undefined,
    );
  }
  return NextResponse.json(
    { user: result.user, temporaryPassword: result.temporaryPassword },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
