// Cookie からログイン中のユーザーを取り出す（Server Component・Route Handler 用）。
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getPreviousLogin, getSessionUser } from "./auth.ts";
import type { User } from "./users.ts";

export async function getCurrentUser(): Promise<User | undefined> {
  const store = await cookies();
  return getSessionUser(store.get(SESSION_COOKIE)?.value);
}

/** ログイン中のセッションの「前回のログイン」（ISO 8601・UTC）。前回が無ければ null、未ログインなら undefined。 */
export async function getCurrentPreviousLogin(): Promise<string | null | undefined> {
  const store = await cookies();
  return getPreviousLogin(store.get(SESSION_COOKIE)?.value);
}

/** ページ用: 未ログインならログイン画面へ移動する。 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
