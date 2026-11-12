# 実装の手順書

Issue に `ready` が付いたときに起動します。1 回の起動で 1 つの Issue を扱います。

## 1. 起動してよいかを確かめる

次のどれかに当たれば、何もせずに終える（コメントもしない）。

- イベントの Issue に `ready` が付いていない。
- Issue が閉じている。
- Issue に `in-progress`・`blocked:question`・`needs-human` のどれかが付いている。
- その Issue を `Closes #<番号>` で参照する、開いている PR がある。
- `ready` を付けた人が、リポジトリへの書き込み権限を持たない。次の順に確かめる。
  1. Issue のイベント（GitHub MCP の `issue_read`、または REST の `GET /repos/{owner}/{repo}/issues/{number}/events`）の最後の `labeled`（ラベル `ready`）から、付けた人を調べる。
  2. GitHub MCP の `list_repository_collaborators` で、その人が `write`・`maintain`・`admin` のどれかを持つかを確かめる。REST の `collaborators/{user}/permission` は、クラウドのプロキシで拒まれるので使わない（2026-11-12 の試行で 403）。
  3. どちらの道具でも調べられなければ、`needs-human` を付けて理由をコメントし、終える。

## 2. 着手する

1. `ready` を外し、`in-progress` を付ける。
2. `main` の最新から `claude/issue-<番号>` のブランチを作る。

## 3. 実装する

- Issue の「受入条件」が完了の条件。受入条件の 1 つずつに対応するテストを `tests/` に書く。
- 計画にない DB のスキーマの変更、外部の利用者に影響する変更、`AGENTS.md` の「罠」に当たる変更が必要になったら、`blocked:question` を付けて、決めてほしいことを選択肢つきでコメントし、終える。
- `npm run typecheck`・`npm test`・`npm run build` がすべて通るまで直す。

## 4. PR を出す

1. コミットして push し、draft の PR を出す。本文は `.github/pull_request_template.md` の見出しに沿い、「関連 Issue」に `Closes #<番号>` を書く。「検証結果」には実際に実行したコマンドと結果を書く。
2. GitHub Actions の CI（`app-check`）の結果を待つ（数分おきに確かめる。15 分たっても終わらなければ、その旨を書いて終える）。
3. CI が落ちたら、原因を直して push する。同じ失敗の修正は 3 回まで。超えたら `needs-human` を付けて、調べたことをコメントし、終える。
4. CI が通ったら、PR を Ready にし、PR に `review:requested` を付ける。

## 5. 終える

Issue に、PR の番号と「レビューの Routine が動く」ことを 1 行でコメントする（先頭に `<!-- factory:implement -->`）。
