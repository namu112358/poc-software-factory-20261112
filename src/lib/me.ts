// GET /api/me の応答を作る。ログイン中のユーザーのうち、外に出してよい項目（ID と名前）だけを返す。
// ほかの端末での新しいログインの知らせ（loginNotice）は、決めた項目だけを詰め直して返す（#478）。無ければ null。
import type { LoginNotice } from "./login-notices.ts";
import type { User } from "./users.ts";

export type MeResponse = { user: { id: string; name: string }; loginNotice: LoginNotice | null };

/** 許可した項目だけを詰める。ユーザーのデータに別の項目が混ざっていても応答には出さない。 */
export function toMeResponse(user: User, loginNotice: LoginNotice | null = null): MeResponse {
  return {
    user: { id: user.id, name: user.name },
    loginNotice: loginNotice && {
      throughId: loginNotice.throughId,
      count: loginNotice.count,
      latest: { device: loginNotice.latest.device, loggedInAt: loginNotice.latest.loggedInAt },
      failedLogins: loginNotice.failedLogins,
    },
  };
}
