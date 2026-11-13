// GET /api/me の応答を作る。ログイン中のユーザーのうち、外に出してよい項目（ID と名前と役割。役割は #524）だけを返す。
// ほかの端末での新しいログインの知らせ（loginNotice）は、決めた項目だけを詰め直して返す（#478）。無ければ null。
// 前回のログインのあとにロックされた知らせ（lockNotice: 回数と最後の日時）も同じように返す（#479）。無ければ null。
import type { LockNotice } from "./auth.ts";
import type { LoginNotice } from "./login-notices.ts";
import type { User, UserRole } from "./users.ts";

export type MeResponse = {
  user: { id: string; name: string; role: UserRole };
  loginNotice: LoginNotice | null;
  lockNotice: LockNotice | null;
};

/** 許可した項目だけを詰める。ユーザーのデータに別の項目が混ざっていても応答には出さない。 */
export function toMeResponse(
  user: User & { role: UserRole },
  loginNotice: LoginNotice | null = null,
  lockNotice: LockNotice | null = null,
): MeResponse {
  return {
    user: { id: user.id, name: user.name, role: user.role === "coordinator" ? "coordinator" : "member" },
    loginNotice: loginNotice && {
      throughId: loginNotice.throughId,
      count: loginNotice.count,
      latest: { device: loginNotice.latest.device, loggedInAt: loginNotice.latest.loggedInAt },
      failedLogins: loginNotice.failedLogins,
    },
    lockNotice: lockNotice && { count: lockNotice.count, lastLockedAt: lockNotice.lastLockedAt },
  };
}
