# 修正の手順書

PR に `review:changes` が付いたときに起動します。直前のレビューの「必須」の指摘に対応します。

## 1. 起動してよいかを確かめる

次のどれかに当たれば、何もせずに終える。

- PR に `review:changes` が付いていない、PR が閉じている。
- head のブランチが `claude/` で始まらない。

当たらなければ、`review:changes` を外す。

## 2. 往復の上限を確かめる

PR のコメントにある `<!-- factory:review verdict=changes ... -->` を数える。3 つ以上（2 往復の修正を終えて、まだ指摘がある）なら、`needs-human` を付け、残っている指摘と、これまでの対応をコメントして終える。

## 3. 直す

1. PR の head のブランチを取り出し、`main` を取り込む。
2. 最新の `verdict=changes` のレビューの「必須」の指摘を 1 つずつ直す。指摘が誤っていると判断したものは直さず、理由を返信に書く。「任意」は、変更が小さく受入条件に関わるものだけ直す。
3. 指摘が受入条件の解釈の違いで、Issue だけでは決められないときは、Issue に `blocked:question` を付けて、決めてほしいことをコメントし、終える。
4. `npm run typecheck`・`npm test`・`npm run build` を通して push する。CI（`app-check`）が通るまで直す（同じ失敗は 3 回まで。超えたら `needs-human`）。

## 4. 終える

PR に、指摘ごとの対応（直した・直さなかった理由）をコメントし（先頭に `<!-- factory:fix -->`）、`review:requested` を付ける。
