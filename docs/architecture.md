# アプリの構成

タスク管理アプリ（Next.js（App Router）+ TypeScript + SQLite（Node 標準の `node:sqlite`））の、作業の前に知っておくと早い説明です。毎回の作業で守る決まりは [AGENTS.md](../AGENTS.md) にあります。ここに書いたことと既存のコードが食い違うときは、コードが正しいものとして扱ってください。

## DB

- `src/lib/db/index.ts` の `getDb()` が共有の接続を返す。接続先は環境変数 `DATABASE_PATH`（既定は `:memory:`。サーバーを起動するたびに `src/lib/db/seed.ts` の初期データから始まる）。
- スキーマは `src/lib/db/migrations.ts`（`PRAGMA user_version` で管理）。
- テストでは `openDb()` で独立したインメモリ DB を作り、`src/lib/` の関数の引数 `db` に渡す。

## ログイン

- 初期ユーザーは `sato` / `suzuki` / `tanaka`（パスワードは共通で `password`。PoC の検証用）。`/login` からログインする。
- 利用者には役割（`users.role`）がある。初期データでは `tanaka` だけが取りまとめる人（`coordinator`）で、`sato`・`suzuki` はメンバー（`member`）。延長の申請を承認・却下できるのは取りまとめる人だけ（自分の申請は除く）。
- 取りまとめる人は、メンバーの一覧（または `PUT /api/users/:id/role`）から、利用者の役割を替えられる。停止していない取りまとめる人が 1 人もいなくなる変更と、停止中の人を取りまとめる人にする変更は断る（409）。役割は要求のたびに DB から読むので、替えた次の要求から効く。役割は `GET /api/users`・`GET /api/me` とヘッダーに出る。
- 取りまとめる人は、メンバーの一覧から、ほかの利用者のログインを停止・再開できる（`users.suspended_at`）。停止した利用者はログインできず、セッションは消え、担当者の選択肢に出ない。利用者の行は消さないので、過去の記録の名前は残る。
- 取りまとめる人は、メンバーの一覧（または `POST /api/users`）から、新しいメンバーのアカウントを作れる。仮のパスワードは作った応答に 1 回だけ含み、DB にはハッシュだけを残す。仮のパスワードの間（`users.must_change_password` が 1）は、`requireUser()` がパスワード変更の画面へ移し、`requireApiUser()` が 403 を返す（パスワード変更の画面と `POST /api/password`、ログアウトだけは使える）。本人がパスワードを変えると 0 に戻る。
- セッションは DB の `sessions` テーブルと Cookie `poc_session`（`src/lib/auth.ts`）。

## API

API の一覧は書かない。今ある API は `src/app/api/` の下の `route.ts` を見る（一覧を書くと、API を足すたびに古くなり、古い一覧が正しいものとして読まれるため。#164・#206）。
