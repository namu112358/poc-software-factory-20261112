type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>ログイン</h1>
      {error !== undefined && <p role="alert">ID またはパスワードが正しくありません。</p>}
      <form method="post" action="/api/login" aria-label="ログイン">
        <p>
          <label>
            ユーザー ID <input name="userId" autoComplete="username" required />
          </label>
        </p>
        <p>
          <label>
            パスワード <input name="password" type="password" autoComplete="current-password" required />
          </label>
        </p>
        <button type="submit">ログイン</button>
      </form>
    </main>
  );
}
