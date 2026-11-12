# アプリの構成

タスク管理アプリ（Next.js（App Router）+ TypeScript + SQLite（Node 標準の `node:sqlite`））の、作業の前に知っておくと早い説明です。毎回の作業で守る決まりは [AGENTS.md](../AGENTS.md) にあります。ここに書いたことと既存のコードが食い違うときは、コードが正しいものとして扱ってください。

## DB

- `src/lib/db/index.ts` の `getDb()` が共有の接続を返す。接続先は環境変数 `DATABASE_PATH`（既定は `:memory:`。サーバーを起動するたびに `src/lib/db/seed.ts` の初期データから始まる）。
- スキーマは `src/lib/db/migrations.ts`（`PRAGMA user_version` で管理）。
- テストでは `openDb()` で独立したインメモリ DB を作り、`src/lib/` の関数の引数 `db` に渡す。

## ログイン

- 初期ユーザーは `sato` / `suzuki` / `tanaka`（パスワードは共通で `password`。PoC の検証用）。`/login` からログインする。
- 利用者には役割（`users.role`）がある。`tanaka` だけが取りまとめる人（`coordinator`）で、`sato`・`suzuki` はメンバー（`member`）。延長の申請を承認・却下できるのは取りまとめる人だけ（自分の申請は除く）。
- セッションは DB の `sessions` テーブルと Cookie `poc_session`（`src/lib/auth.ts`）。

## API

API の一覧は書かない。今ある API は `src/app/api/` の下の `route.ts` を見る（一覧を書くと、API を足すたびに古くなり、古い一覧が正しいものとして読まれるため。#164・#206）。
