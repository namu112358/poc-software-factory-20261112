// Cookie からログイン中のユーザーを取り出す（Server Component・Route Handler 用）。
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  getFailedLoginsBefore,
  getLockNotice,
  getLoginWindow,
  getPreviousLogin,
  getSessionUserAndTouch,
  type LockNotice,
} from "./auth.ts";
import { getLoginNotice, type LoginNotice } from "./login-notices.ts";
import { mustChangePassword, type User } from "./users.ts";

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

/** ログイン中のセッションで、ログインした時点の「前回のログインのあとにロックされた回数と最後の日時」。無ければ null、未ログインなら undefined。 */
export async function getCurrentLockNotice(): Promise<LockNotice | null | undefined> {
  const store = await cookies();
  return getLockNotice(store.get(SESSION_COOKIE)?.value);
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

/** 仮のパスワードの間（#523）に移す、パスワード変更の画面。 */
export const PASSWORD_CHANGE_PATH = "/settings/password";

/**
 * ページ用: 未ログインならログイン画面へ移動する。
 * 仮のパスワードのまま（#523）なら、パスワード変更の画面へ移動する（その画面だけは allowPasswordChangePending で通す）。
 */
export async function requireUser(options: { allowPasswordChangePending?: boolean } = {}): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!options.allowPasswordChangePending && mustChangePassword(user.id)) redirect(PASSWORD_CHANGE_PATH);
  return user;
}
