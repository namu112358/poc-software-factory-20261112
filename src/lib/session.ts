// Cookie からログイン中のユーザーを取り出す（Server Component・Route Handler 用）。
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getSessionUser } from "./auth.ts";
import type { User } from "./users.ts";

export async function getCurrentUser(): Promise<User | undefined> {
  const store = await cookies();
  return getSessionUser(store.get(SESSION_COOKIE)?.value);
}

/** ページ用: 未ログインならログイン画面へ移動する。 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
