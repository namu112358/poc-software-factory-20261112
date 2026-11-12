# 実装の手順書

Issue に `ready` か `ready:hard` が付いたときに起動します。1 回の起動で 1 つの Issue を扱います。起動のラベルが `ready` なら標準の役、`ready:hard` なら難しい用の役です（`README.md` の「難易度」）。以下の `ready` は、起動のラベルを指します。

## 1. 起動してよいかを確かめる

次のどれかに当たれば、何もせずに終える（コメントもしない）。

- イベントの Issue に `ready` が付いていない。
- Issue が閉じている。
- Issue に `in-progress`・`blocked:question`・`needs-human` のどれかが付いている。
- その Issue を `Closes #<番号>` で参照する、開いている PR がある。
- `ready` を付けた人が、リポジトリへの書き込み権限を持たない。次の順に確かめる。
  1. Issue のイベント（GitHub MCP の `issue_read`、または REST の `GET /repos/{owner}/{repo}/issues/{number}/events`）の最後の `labeled`（ラベル `ready`）から、付けた人を調べる。
  2. GitHub MCP の `list_repository_collaborators` で、その人が `write`・`maintain`・`admin` のどれかを持つかを確かめる。REST の `collaborators/{user}/permission` は、クラウドのプロキシで拒まれるので使わない（2026-11-12 の試行で 403）。
  3. どちらの道具でも調べられなければ、`ready` を外して `needs-human` を付け、理由をコメントし、終える。

### キューに載せる

次のどちらかに当たれば、`ready` を外して `queued` を付け、何を待っているか（依存先の番号、または「空き待ち」）をコメントして終える（`README.md` の「キュー」）。

- Issue の依存先（`README.md` の「キュー」の定義。blocked by と、本文の「#N の後」）に、まだ開いているものがある。
- `in-progress` の付いた開いている Issue が、すでに 4 件ある。
- 開いている `claude/` の PR のどれかが、この Issue で変えそうなファイルを、すでに変えている（衝突の予防）。調べ方: Issue の受入条件から、変える画面・API・表を挙げ、リポジトリを検索して変えそうなファイル（テストを除く）を決める。開いている `claude/` の PR の変更ファイルの一覧（`pull_request_read` の `get_files`）と、`in-progress` の付いたほかの Issue の `<!-- factory:touch files=... -->` のコメントと突き合わせる。重なれば、その PR（PR がまだ無ければ、その Issue）を待つ。コメントの先頭に `<!-- factory:queued wait=#<PR の番号> -->` を付け、どのファイルが重なったかを書く。`src/lib/db/migrations.ts` も、重なりとして数える。

### 難易度を判定する（標準の役だけ）

`README.md` の「難易度」の観点で判定する。1 つでも当たれば、`ready` を外して `ready:hard` を付け、当たった観点をコメントして終える（キューからは取り出さない）。

## 2. 着手する

1. `ready` を外し、`in-progress` を付ける。続けて、変えそうなファイルを Issue にコメントする（先頭に `<!-- factory:touch files=<カンマ区切りのパス> -->`）。後から着手する役が、衝突の予防に使う。
2. 記録してから 30 秒待ち、`in-progress` の付いたほかの Issue の `factory:touch` のコメントを読み直す。自分の記録と同じファイルを含み、自分より前の時刻（同じ時刻なら、Issue の番号が小さいほう）に記録したものがあれば、自分が引き下がる: `in-progress` を外して `queued` を付け、`<!-- factory:queued wait=#<その Issue の番号> -->` でコメントして終える（ほぼ同時に着手した作業どうしが、お互いの記録を見落とさないため）。
3. `main` の最新から `claude/issue-<番号>` のブランチを作る（ほかの名前にしない。巡回と集計がこの名前で Issue と PR を結び付ける）。

## 3. 実装する
- 難しい用の役は、実装の前に計画を Issue にコメントする（先頭に `<!-- factory:plan -->`）。計画には、受入条件に書かれていないが守るべきこと（入力の誤り・境界・時差・全部か無しか・権限・同時更新など、この Issue に関係するもの）の一覧を入れ、その 1 つずつにテストを書く。
- 標準の役は、実装の途中で `README.md` の「難易度」の観点に当たると分かったら（例: 触る場所にテストが無く理由の書かれていない分岐がある、同時に更新される処理が絡む）、まだ push していなければ、作業を捨てて難しい用に回す: `in-progress` を外して `ready:hard` を付け、分かったこと（当たった観点と、その場所）をコメントして終える（着手の前の判定と同じく、キューからは取り出さない。空きは難しい用が使う。難しい用は `main` の最新から同じ名前のブランチを作るので、push しない）。push した後に分かったときは回さず、PR の「注意事項・残課題」に当たった観点を書く（レビューの役が重点的に見る）。
- Issue の「受入条件」が完了の条件。受入条件の 1 つずつに対応するテストを `tests/` に書く。
- 計画にない DB のスキーマの変更、外部の利用者に影響する変更、`AGENTS.md` の「罠」に当たる変更が必要になったら、`in-progress` を外して `blocked:question` を付け、決めてほしいことを選択肢つきでコメントし、終える。
- `npm run typecheck`・`npm test`・`npm run build` がすべて通るまで直す。

## 4. PR を出す

1. コミットして push し、draft の PR を出す。本文は `.github/pull_request_template.md` の見出しに沿い、「関連 Issue」に `Closes #<番号>` を書く。「検証結果」には実際に実行したコマンドと結果を書く。
2. GitHub Actions の CI（`app-check`）の結果を待つ（数分おきに確かめる）。待つ前と待つ間に、PR が `main` と衝突していないか（`mergeable`）を見る。衝突していれば、GitHub は CI を動かさないので、`main` を取り込んで衝突を解消し、push してから待ち直す（ほかの PR が先にマージされると起きる）。15 分たっても終わらなければ、その旨を Issue に書き、`in-progress` を付けたまま終える（巡回が、止まった実装として拾う）。
3. CI が落ちたら、原因を直して push する。同じ失敗の修正は 3 回まで。超えたら、Issue の `in-progress` を外して `needs-human` を付け、調べたことをコメントし、終える（PR は draft のまま）。
4. CI が通ったら、PR を Ready にする（これがレビューの起動の合図）。Issue の `in-progress` を外す。

## 5. 終える

Issue に、PR の番号と「レビューの Routine が動く」ことを 1 行でコメントする（先頭に `<!-- factory:implement -->`）。

`blocked:question` か `needs-human` を付けて止まるときは、`ready` と `in-progress` が外れていることを確かめてから終える（`README.md` の「ラベル」）。

PR を Ready にしたとき、または止まるときは、最後にキューから 1 件取り出す（`README.md` の「キュー」）。キューに載せて終えるときは、取り出さない。
