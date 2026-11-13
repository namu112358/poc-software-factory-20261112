import { formatLoginError } from "@/lib/login-error";
import { formatPageTitle } from "@/lib/page-title";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { afterLoginPath, safeNextPath } from "@/lib/session-expired";
import { PasswordField } from "./password-field";

type Props = {
  searchParams: Promise<{ error?: string | string[]; minutes?: string | string[]; next?: string | string[] }>;
};

export const metadata = { title: formatPageTitle("ログイン") };

export default async function LoginPage({ searchParams }: Props) {
  const { error, minutes, next } = await searchParams;
  // ログイン済みなら、ログイン画面を見せずに戻り先（無ければタスク一覧）へ移す。
  if (await getCurrentUser()) redirect(afterLoginPath(next));
  // ログインした後の戻り先（#491）。このアプリの中の画面だけを送る。
  const nextPath = safeNextPath(next);
  const message = formatLoginError(error, minutes);
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>ログイン</h1>
      {message && <p role="alert">{message}</p>}
      <form method="post" action="/api/login" aria-label="ログイン">
        {nextPath !== undefined && <input type="hidden" name="next" value={nextPath} />}
        <p>
          <label>
            ユーザー ID <input name="userId" autoComplete="username" required />
          </label>
        </p>
        <p>
          <PasswordField />
        </p>
        <button type="submit">ログイン</button>
      </form>
    </main>
  );
}
