import { formatLoginError } from "@/lib/login-error";
import { formatPageTitle } from "@/lib/page-title";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { PasswordField } from "./password-field";

type Props = {
  searchParams: Promise<{ error?: string | string[]; minutes?: string | string[] }>;
};

export const metadata = { title: formatPageTitle("ログイン") };

export default async function LoginPage({ searchParams }: Props) {
  // ログイン済みなら、ログイン画面を見せずにタスク一覧へ移す。
  if (await getCurrentUser()) redirect("/tasks");
  const { error, minutes } = await searchParams;
  const message = formatLoginError(error, minutes);
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>ログイン</h1>
      {message && <p role="alert">{message}</p>}
      <form method="post" action="/api/login" aria-label="ログイン">
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
