# レビューの手順書

PR が Ready for review になったときに起動します。実装した役とは別のセッションで、PR を独立にレビューします。コードは直しません。

## 1. 起動してよいかを確かめる

`node scripts/factory/claim.ts gate --role review --number <番号>` を実行し、`decision` が `stop` なら何もせずに終える。`go` で `light` が `true` なら、次の「軽い再レビュー」だけを行う。

### 軽い再レビュー

前回のレビューが `verdict=ok` で、その後に PR に入ったコミットが「`main` の取り込み（マージのコミット）」と、その衝突の解消だけのとき（`light`）は、2 段の確かめはせず、次だけを行う。

- 衝突を解消した箇所（マージのコミットで、`main` の側とも PR の側とも違う行）を読み、両方の変更の意図が残っているかを見る。
- `npm run typecheck`・`npm test`・`npm run build` が通るかを見る（`design-system/` を変えた PR は、`design-system/` でも `npm run typecheck`・`npm run lint`・`npm test`・`npm run build`）。

問題が無ければ verdict=ok にする（コメントに「軽い再レビュー」と書く）。

## 2. 確かめる

PR が `Closes #<番号>` で参照する Issue を読み、次の 2 段を順に行う。2 段を混ぜない。`Closes` の Issue が無い PR（手順書や設定だけの変更など）は、受入条件の代わりに PR 本文の「変更内容」と照合する。

1. **要件の照合**: Issue の受入条件を 1 つずつ取り上げ、満たしているかを、コードとテストを読んで判定する。判定ごとに根拠（ファイルと行、テストの名前）を書く。受入条件に書かれていないが、同じ画面・API の既存の振る舞い（ログインの確認、入力の検証、エラーの形）とそろっているかも見る。
2. **動かして確かめる**: PR のブランチで `npm run build` と `npm start` を実行し、変更した画面と API を実際に開く（`curl` か Playwright）。ログインが要るものは、初期ユーザー（`docs/architecture.md` を参照）でログインしてから確かめる。開いた URL・状態コード・エラーの有無を結果として書く。コマンドは 1 回に 1 つ（`README.md` の「どの役にも共通の決まり」）。`npm start` は Bash の `run_in_background` で単独で起動し、確かめが複数の手順なら、Write でスクラッチパッドにスクリプト（.mjs など）を書いて `node <ファイル>` で実行する。`;`・`&&`・`&`・シェル変数は使わない。
   - `design-system/` の変更は、アプリを起動する代わりに、`design-system/` で `npm ci`・`npm test`・`npm run build` を実行し、書き出した `storybook-static/` を静的に配って（`python3 -m http.server 6006 --directory storybook-static` を、Bash の `run_in_background` で単独で起動する。`&` や `(... &)` で裏に回さず、ほかのコマンドとつながない）、変更した部品の Story を Playwright で開く（複数の手順は Write でスクリプトにして `node <ファイル>` で実行する）（`iframe.html?id=<Story の id>&viewMode=story`）。受入条件のキーボード操作を実際に行い、暗い表示（`&globals=theme:dark`）でも開く。あわせて `AGENTS.md` の「design-system/」の規約（トークンだけ・意味のある状態だけ・Docs の使う場面と使わない場面・新しい依存が無い）に反していないかを見る。開いた Story・行った操作・axe とコンソールのエラーの有無を結果として書く。

あわせて、PR が `main` と衝突していないか（`mergeable`）を見る。衝突していれば、それを「必須」の指摘にする。

既存の API の応答の項目・受け付ける値が変わる PR では、変わった点（足した・消した・意味の変わった項目、新しく断る・受け付ける値、状態コード）をレビューのコメントに一覧にし、その API を使う画面と `docs/` の説明が合っているかを確かめる。合っていなければ「必須」の指摘にする（外部の利用者に効く変更を、`risk:high` の代わりにレビューで確かめる。台帳 #123 の E26）。

`riskFiles` が空でなければ、PR に `risk:high` を付け、レビューのコメントにどのファイルに当たるかを書く。他人のデータを見せる・変える範囲の変更は、読んで判断する。`risk:high` は verdict には影響させない。`risk:high` は、結果を書く（3.）より前に付ける（ok のレビューを書くと PR は自動でキューに入るので、後から付けると間に合わないことがある）。

## 3. 結果を書く

書く直前に PR のレビューを読み直し、同じコミット（`commit=`）へのレビューがもうあれば、書かずに終える（同じ版に 2 つのレビューが付くと、どちらが有効か分からなくなる。#296）。無ければ、PR にレビューのコメントを 1 つ書く（`pull_request_review_write` の `COMMENT`。Approve はしない）。先頭は次の形にする。

```
<!-- factory:review verdict=<ok|changes> round=<この PR で何回目のレビューか> commit=<レビューしたコミットの SHA> -->
```

- 直すべき指摘には、それぞれ「必須」を付け、どの受入条件・どの確かめた結果に反するかを書く。好みの問題は「任意」にし、verdict には数えない。
- 「必須」が 1 つでもあれば verdict=changes にし、PR を draft に戻す（これが修正の起動の合図）。
- 無ければ verdict=ok にし、Ready のままにする。それ以上は何もしない（`risk:high` 以外は、GitHub Actions がレビューの結果を status にして、自動でキューに入る。`risk:high` は人が `merge:requested` を付ける）。
