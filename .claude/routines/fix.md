# 修正の手順書

PR が draft に戻されたときに起動します。直前のレビューの「必須」の指摘と、`main` との衝突に対応します。

## 1. 起動してよいかを確かめる

`node scripts/factory/claim.ts gate --role fix --number <番号>` を実行する。`stop` なら何もせずに終える。`needs-human` なら、`ops` のとおりに PR にラベルとコメントを書き（残っている指摘と、これまでの対応も書き足す）、PR は draft のまま終える。`go` なら、`fix` のとおりに「2.」へ進む（`changes` は最新のレビューの指摘が未対応、`conflict` は `main` との衝突）。

## 2. 直す

1. `fix.removeMergeRequested` が `true` なら、PR の `merge:requested` のラベルを外す（直した中身を人がレビューの結果と合わせて見てから、付け直す。付いたままだと、Mergify が直した版をレビューの前にキューに戻してしまう）。自動でキューに入る PR は、直して push すると最新のコミットにレビューの status が無くなるので、レビューで ok になるまで入らない。
2. PR の head のブランチを取り出し、`main` を取り込む。衝突があれば、両方の変更の意図が残るように解消する。
3. 最新の `verdict=changes` のレビューの「必須」の指摘を 1 つずつ直す。指摘が誤っていると判断したものは直さず、理由を書く。「任意」は、変更が小さく受入条件に関わるものだけ直す。
4. 指摘が受入条件の解釈の違いで、Issue だけでは決められないときは、Issue に `status:blocked-question` を付けて、決めてほしいことをコメントし、終える（PR は draft のまま）。
5. `npm run typecheck`・`npm test`・`npm run build` を通して push する（`design-system/` を変えた PR は、`npm --prefix design-system run typecheck`・`npm --prefix design-system run lint`・`npm --prefix design-system test`・`npm --prefix design-system run build` も）。CI は `node scripts/factory/claim.ts ci-wait --pr <PR> --role fix` をバックグラウンドで実行して待ち、`failure` なら直す（同じ失敗は 3 回まで。超えたら `status:needs-human`）。ほかの `result` は実装の手順書の「4.」の 2 と同じ。

## 3. 終える

PR に、指摘ごとの対応（直した・直さなかった理由）をコメントし（先頭に `<!-- factory:fix -->`）、PR を Ready にする（これがレビューの起動の合図）。
