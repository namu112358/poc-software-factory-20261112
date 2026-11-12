import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { PasswordField } from "./password-field";

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  // ログイン済みなら、ログイン画面を見せずにタスク一覧へ移す。
  if (await getCurrentUser()) redirect("/tasks");
  const { error } = await searchParams;
  return (
    <main>
      <h1>ログイン</h1>
      {error === "locked" ? (
        <p role="alert">ログインに続けて失敗したため、しばらくしてからもう一度お試しください。</p>
      ) : (
        error !== undefined && <p role="alert">ID またはパスワードが正しくありません。</p>
      )}
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
