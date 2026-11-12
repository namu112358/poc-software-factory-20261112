# 実装の手順書

Issue に `ready` か `ready:hard` が付いたときに起動します。1 回の起動で 1 つの Issue を扱います。起動のラベルが `ready` なら標準の役、`ready:hard` なら難しい用の役です（`README.md` の「難易度」）。以下の `ready` は、起動のラベルを指します。

## 1. 起動してよいかを確かめる

次のどれかに当たれば、何もせずに終える（コメントもしない）。

- イベントの Issue に `ready` が付いていない。
- Issue が閉じている。
- Issue に `epic` が付いている（Epic は子の Issue をまとめるだけで、実装しない）。
- Issue に `in-progress`・`blocked:question`・`needs-human` のどれかが付いている。
- その Issue を `Closes #<番号>` で参照する、開いている PR がある。ただし、その PR が `claude/issue-<番号>` の draft の PR なら終えずに、下の「残った PR を引き継ぐ」に進む。
- `ready` を付けた人が、リポジトリへの書き込み権限を持たない。次の順に確かめる。
  1. Issue のイベント（GitHub MCP の `issue_read`、または REST の `GET /repos/{owner}/{repo}/issues/{number}/events`）の最後の `labeled`（ラベル `ready`）から、付けた人を調べる。
  2. GitHub MCP の `list_repository_collaborators` で、その人が `write`・`maintain`・`admin` のどれかを持つかを確かめる。REST の `collaborators/{user}/permission` は、クラウドのプロキシで拒まれるので使わない（2026-11-12 の試行で 403）。
  3. どちらの道具でも調べられなければ、`ready` を外して `needs-human` を付け、理由をコメントし、終える。

### 残った PR を引き継ぐ

前の実装のセッションが、PR を出した後に引き下がったり止まったりして、`claude/issue-<番号>` の draft の PR が残っていることがある（#248）。そのときは新しく作らず、その PR を引き継ぐ: `ready` を外して `in-progress` を付け、PR のブランチを取り出して「4. PR を出す」の 2 から続ける（`main` との衝突を見て、CI を待ち、通ったら Ready にする）。


変えそうなファイル（テストを除く）を決める。Issue の受入条件から、変える画面・API・表を挙げ、リポジトリを検索して決める（`src/lib/db/migrations.ts` も含める）。続けて判定のスクリプトを実行し、その結果に従う。件数や重なりを、手順書の文を読んで自分で数え直さない（#137）。

```
node scripts/factory/claim.ts precheck <番号> --files <カンマ区切りのパス>
```

- `"decision": "go"` なら次に進む。`note` があれば、それに従う（自分の PR がすでに開いていれば、引き下がらずに「残った PR を引き継ぐ」に進む）。
- `"decision": "queue"` なら、`ready` を外して `queued` を付け、結果の `comment` をそのままコメントして終える（キューからは取り出さない）。`comment` の先頭の `factory:queued` には、どの理由でも `files=` が付いている（後から来た Issue と取り出す役が、重なりを見るのに使う。#216）。
- `"decision": "error"` なら、`ready` を外して `needs-human` を付け、出力をコメントして終える。

スクリプトが確かめること（`README.md` の「キュー」）: 依存先がすべて閉じているか、自分以外の作業中が 4 件未満か、変えそうなファイルが、開いている `claude/` の PR・作業中のほかの Issue の `factory:touch`・自分より古い `queued` の Issue の `files=` と重ならないか。

### 難易度を判定する（標準の役だけ）

`README.md` の「難易度」の観点で判定する。1 つでも当たれば、`ready` を外して `ready:hard` を付け、当たった観点をコメントして終える（キューからは取り出さない）。

## 2. 着手する

1. `ready` を外し、`in-progress` を付ける。続けて、変えそうなファイルを Issue にコメントする（先頭に `<!-- factory:touch files=<カンマ区切りのパス> -->`）。後から着手する役が、衝突の予防に使う。
2. 記録した後、`node scripts/factory/claim.ts confirm <番号>` を実行する（中で 30 秒待ってから読み直す）。`"decision": "retreat"` なら、`in-progress` を外して `queued` を付け、結果の `comment` をそのままコメントして終える（キューからは取り出さない）。`"go"` なら次に進む（`note` があれば、それに従う）。`"error"` なら、`in-progress` を外して `needs-human` を付け、出力をコメントして終える。スクリプトは、それぞれの Issue の最新の `factory:touch` の時刻で前後を決め（同じ時刻なら番号が小さいほうが先）、先に記録した作業と同じファイルを含むか、先に記録した作業中の Issue（記録の無いものを含む）が 4 件以上あれば、引き下がらせる（ほぼ同時の着手で、お互いの記録を見落としたり上限を超えたりしないため。#137）。
3. `main` の最新から `claude/issue-<番号>` のブランチを作る（ほかの名前にしない。巡回と集計がこの名前で Issue と PR を結び付ける）。

## 3. 実装する
- 難しい用の役は、実装の前に計画を Issue にコメントする（先頭に `<!-- factory:plan -->`）。標準の役の引き継ぎ（`factory:handoff`）があれば、それを読んで計画に取り込む。計画には、受入条件に書かれていないが守るべきこと（入力の誤り・境界・時差・全部か無しか・権限・同時更新など、この Issue に関係するもの）の一覧を入れ、その 1 つずつにテストを書く。
- 標準の役は、実装の途中で `README.md` の「難易度」の観点に当たると分かったら（例: 触る場所にテストが無く理由の書かれていない分岐がある、同時に更新される処理が絡む）、まだ push していなければ、作業を捨てて難しい用に回す: 先に、引き継ぎの計画を Issue にコメントし（先頭に `<!-- factory:handoff -->`。当たった観点とその場所、受入条件に書かれていないが守るべきことの案、ここまでに分かった実装の方針）、続けて `in-progress` を外して `ready:hard` を付けて終える（着手の前の判定と同じく、キューからは取り出さない。空きは難しい用が使う。難しい用は `main` の最新から同じ名前のブランチを作るので、push しない）。push した後に分かったときは回さず、PR の「注意事項・残課題」に当たった観点を書く（レビューの役が重点的に見る）。
- Issue の「受入条件」が完了の条件。受入条件の 1 つずつに対応するテストを `tests/` に書く。
- 計画にない DB のスキーマの変更、外部の利用者に影響する変更、`AGENTS.md` の「罠」に当たる変更が必要になったら、`in-progress` を外して `blocked:question` を付け、決めてほしいことを選択肢つきでコメントし、終える。
- `npm run typecheck`・`npm test`・`npm run build` がすべて通るまで直す。

## 4. PR を出す

1. コミットして push し、draft の PR を出す。本文は `.github/pull_request_template.md` の見出しに沿い、「関連 Issue」に `Closes #<番号>` を書く。「検証結果」には実際に実行したコマンドと結果を書く。「注意事項・残課題」には、`AGENTS.md` の「このプロジェクトの罠」のうち、この PR で当てはめたものを 1 行ずつ書く（無ければ「当てはめた罠: なし」）。振り返りの役が、決まりの効き目を数えるのに使う。
2. GitHub Actions の CI（`app-check`）の結果を待つ（数分おきに確かめる）。待つ前と待つ間に、PR が `main` と衝突していないか（`mergeable`）を見る。衝突していれば、GitHub は CI を動かさないので、`main` を取り込んで衝突を解消し、push してから待ち直す（ほかの PR が先にマージされると起きる）。15 分たっても終わらなければ、その旨を Issue に書き、`in-progress` を付けたまま終える（巡回が、止まった実装として拾う）。
3. CI が落ちたら、原因を直して push する。同じ失敗の修正は 3 回まで。超えたら、Issue の `in-progress` を外して `needs-human` を付け、調べたことをコメントし、終える（PR は draft のまま）。
4. CI が通ったら、PR を Ready にする（これがレビューの起動の合図）。Issue の `in-progress` を外す。

## 5. 終える

Issue に、PR の番号と「レビューの Routine が動く」ことを 1 行でコメントする（先頭に `<!-- factory:implement -->`）。

`blocked:question` か `needs-human` を付けて止まるときは、`ready` と `in-progress` が外れていることを確かめてから終える（`README.md` の「ラベル」）。

PR を Ready にしたとき、または止まるときは、最後にキューから 1 件取り出す（`README.md` の「キュー」。`claim.ts pick` の `pick` の先頭の 1 件だけ。`rewait` は、2 件目以降を取り出す役のためのものなので書かない）。`pick` が `error` なら取り出さず、終えるコメントに出力を書く（割り当て・巡回が後で取り出す）。キューに載せて終えるときは、取り出さない。
