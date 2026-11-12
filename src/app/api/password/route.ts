// POST /api/password — ログイン中の本人のパスワードを変える（{ currentPassword, newPassword }）。
// 変えると、同じ利用者のほかのセッションはすべて無効になり、今のセッションだけが残る。
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { SESSION_COOKIE, changePassword, validatePasswordChangeInput } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return jsonError(401, "ログインしてください");

  const input = validatePasswordChangeInput(await readJson(request));
  if (!input.ok) return jsonError(400, "入力内容に誤りがあります", input.errors);

  const result = changePassword(user.id, token, input.value);
  if (!result.ok) {
    return result.reason === "locked"
      ? jsonError(429, "パスワードの確認に続けて失敗したため、しばらく変更できません", [
          `あと ${result.retryAfterMinutes} 分後に試せます`,
        ])
      : jsonError(400, "入力内容に誤りがあります", ["今のパスワードが正しくありません"]);
  }
  return NextResponse.json({ ok: true });
}
