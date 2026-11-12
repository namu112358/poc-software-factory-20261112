// GET /api/me の応答を作る。ログイン中のユーザーのうち、外に出してよい項目（ID と名前）だけを返す。
import type { User } from "./users.ts";

export type MeResponse = { user: { id: string; name: string } };

/** 許可した項目だけを詰める。ユーザーのデータに別の項目が混ざっていても応答には出さない。 */
export function toMeResponse(user: User): MeResponse {
  return { user: { id: user.id, name: user.name } };
}
