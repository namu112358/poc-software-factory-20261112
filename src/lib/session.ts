// Cookie からログイン中のユーザーを取り出す（Server Component・Route Handler 用）。
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getFailedLoginsBefore, getLoginWindow, getPreviousLogin, getSessionUserAndTouch } from "./auth.ts";
import { getLoginNotice, type LoginNotice } from "./login-notices.ts";
import type { User } from "./users.ts";

/** ログイン中のユーザーを返し、この端末の「最後に使った日時」を更新する（5 分以内の再利用では更新しない）。 */
export async function getCurrentUser(): Promise<User | undefined> {
  const store = await cookies();
  return getSessionUserAndTouch(store.get(SESSION_COOKIE)?.value);
}

/** ログイン中のセッションの「前回のログイン」（ISO 8601・UTC）。前回が無ければ null、未ログインなら undefined。 */
export async function getCurrentPreviousLogin(): Promise<string | null | undefined> {
  const store = await cookies();
  return getPreviousLogin(store.get(SESSION_COOKIE)?.value);
}

/** ログイン中のセッションで、ログインした時点の「前回のログインのあとにパスワードを誤ったログインの回数」。未ログインなら undefined。 */
export async function getCurrentFailedLoginsBefore(): Promise<number | undefined> {
  const store = await cookies();
  return getFailedLoginsBefore(store.get(SESSION_COOKIE)?.value);
}

/** ログイン中のセッションの、ログインした時点の前回・今回のログインの日時。 */
export async function getCurrentLoginWindow() {
  const store = await cookies();
  return getLoginWindow(store.get(SESSION_COOKIE)?.value);
}

/** ログイン中のセッションに出す、ほかの端末での新しいログインの知らせ。無ければ null、未ログインなら undefined。 */
export async function getCurrentLoginNotice(): Promise<LoginNotice | null | undefined> {
  const store = await cookies();
  return getLoginNotice(store.get(SESSION_COOKIE)?.value);
}

/** ページ用: 未ログインならログイン画面へ移動する。 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
