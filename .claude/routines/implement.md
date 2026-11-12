# 実装の手順書

Issue に `status:in-progress` か `status:in-progress-hard` が付いたときに起動します。1 回の起動で 1 つの Issue を扱います。`status:in-progress` なら標準の役、`status:in-progress-hard` なら難しい用の役です。以下の `status:in-progress` は、起動のラベルを指します。着手してよいか（空き・同じファイル・依存・難易度）は割り当ての役が判定済みなので、やり直さずに実装に入ります。

## 1. 起動してよいかを確かめる

次のどれかに当たれば、何もせずに終える（コメントもしない）。

- Issue に起動のラベルが付いていない、Issue が閉じている、`kind:epic`・`status:blocked-question`・`status:needs-human` のどれかが付いている。
- 起動のラベルが付いた後に、着手のコメント（`<!-- factory:implement action=start -->`）がもうある。
- その Issue を `Closes` で参照する開いている PR がある。ただし、`claude/issue-<番号>` の draft の PR で、レビュー（`factory:review`）がまだ無いなら、下の「残った PR を引き継ぐ」に進む。
- 起動のラベルを付けた人（Issue のイベントの最後の `labeled`）が、GitHub MCP の `list_repository_collaborators` で `write`・`maintain`・`admin` を持たない。調べられなければ、起動のラベルを外して `status:needs-human` を付け、理由をコメントして終える。

### 残った PR を引き継ぐ

新しく作らず、「2.」の 1 のコメントを書き、PR のブランチを取り出して「4.」の 2 から続ける。

## 2. 着手する

1. Issue に `<!-- factory:implement action=start -->` で始まるコメントを書く。割り当ての役の着手の記録（`factory:touch`）と、自分で調べた変えるファイルが違えば、同じコメントに `<!-- factory:touch files=<カンマ区切りのパス> -->` も書く。
2. `main` の最新から `claude/issue-<番号>` のブランチを作る（ほかの名前にしない）。

## 3. 実装する

- Issue の受入条件が完了の条件。1 つずつに対応するテストを `tests/` に書く。テストは、条件の対象を広く取る（例: 「利用者の一覧から選べる」なら、タスクを持たない利用者も選べること）。
- 画面にテスト ID・見出し・文言を足すときは、同じ画面に出る既存のもの（`src/app/layout.tsx` のヘッダーを含む）を検索し、重ならないようにする。
- 難しい用の役は、実装の前に計画を Issue にコメントする（先頭に `<!-- factory:plan -->`）。引き継ぎ（`factory:handoff`）があれば取り込む。計画には、受入条件に書かれていないが守るべきこと（入力の誤り・境界・時差・全部か無しか・権限・同時更新、それに既存のほかの入口（まとめて変える・削除・復元・複製など）から同じデータを変えたときにも効くか）の一覧を入れ、1 つずつにテストを書く（機能と機能のつなぎ目の抜けは、レビューでも見つけにくかった。#340・#362）。
- 標準の役は、実装の途中で次のどれかに当たると分かり、まだ push していなければ、難しい用に回す: 引き継ぎの計画（`<!-- factory:handoff -->`。当たった観点と場所・守るべきことの案・実装の方針）をコメントし、`status:in-progress` を外して `status:in-progress-hard` を付けて終える。push した後なら回さず、PR の「注意事項・残課題」に書く。
  - 元に戻しにくい・外部の利用者がいる・テストの無い理由不明の分岐がある・まとめて処理する／同時に更新される・認証／権限／お金が絡む
- 計画にない DB のスキーマの変更、外部の利用者に影響する変更、`AGENTS.md` の「罠」に当たる変更が要るなら、`status:in-progress` を外して `status:blocked-question` を付け、決めてほしいことを選択肢つきでコメントして終える。
- `npm run typecheck`・`npm test`・`npm run build` がすべて通るまで直す。

## 4. PR を出す

1. コミットして push し、draft の PR を出す。PR には Issue と同じ `type:` のラベルを付ける（Issue に無ければ、変更の中身から 1 つ選ぶ）。本文は `.github/pull_request_template.md` の見出しに沿い、「関連 Issue」に `Closes #<番号>`、「検証結果」に実行したコマンドと結果と、受入条件ごとの確かめ方（1 条件 1 行。テストの名前か、`npm start` で起動して画面・API を見た結果。表示の位置・見た目など、テストで確かめられない条件は起動して確かめる）、「注意事項・残課題」に当てはめた `AGENTS.md` の「罠」を 1 行ずつ（無ければ「当てはめた罠: なし」）書く。
2. CI（`app-check`）を待つ。待ち始めを `date -u` で記録し、バックグラウンドの until ループ（CI が終わるか 15 分たつまで）で待つ。待つ前と待つ間に `mergeable` を見て、衝突していれば `main` を取り込んで解消し、push して待ち直す。打ち切る前に、15 分たったことを `date -u` で確かめ、CI をもう一度だけ読み直す。終わっていなければ、待ち始めと打ち切った時刻を Issue に書き、`status:in-progress` を外して終える（PR は draft のまま）。
3. CI（`app-check`）が落ちたら直して push する（draft の間に PR 本文の検査 `pr-body-check` が赤くなっても、ここでは数えない）。同じ失敗の修正は 3 回まで。超えたとき、または `main` の不具合など、この Issue の変更では直せない失敗のときは、`status:in-progress` を外して `status:needs-human` を付け、調べたことをコメントして終える。CI の失敗で終えるときは、何も残さずに終えない（#351 は黙って止まり、52 分気づかれなかった）。
4. CI が通ったら PR を Ready にし（レビューの合図）、`status:in-progress` を外す。

## 5. 終える

Issue に、PR の番号と「レビューの Routine が動く」ことを 1 行でコメントする（先頭に `<!-- factory:implement -->`）。止まるときは、`status:ready` と `status:in-progress` が外れていることを確かめる。ほかの Issue に `status:in-progress` は付けない。
