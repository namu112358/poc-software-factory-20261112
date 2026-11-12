# 割り当ての手順書

`claude/` の PR が閉じたとき（マージを含む）に起動します。待っている Issue に実装を始めさせ、マージの後の衝突・起動しなかった実装・止まった実装を拾います。コードは書きません。以下の `status:in-progress` は `status:in-progress-hard` も含みます。

## 0. ほかの割り当てと重ならないようにする

きっかけの PR が閉じた時刻を T として `node scripts/factory/claim.ts handled --since <T>` を実行し、`handled` の Issue・PR には 1〜4 で触らない。`error` なら、この確かめを飛ばす。

## 1. 衝突した PR を修正に回す

開いている `claude/` の Ready の PR で、`main` と衝突しているもの（`mergeable` が false）に、衝突していることをコメントして draft に戻す。`mergeable` が `null` なら 1 分待って一度だけ読み直し、まだ `null` なら触らない。`status:needs-human` の付いた PR には触らない。遅れているだけの PR（`behind`）は更新しない。

## 2. 待っている Issue に着手させる

`node scripts/factory/claim.ts pick` を実行する（`error` なら、出力を終えるコメントに書いて 3 へ）。`rewait` の Issue には、その `comment` をそのままコメントする。

`pick` の Issue ごとに、順に次を行う。2 件目からは、前の 1 件にラベルを付けてから 30 秒あける（`node -e "setTimeout(() => {}, 30000)"`）。

1. ラベルを読み直し、`status:ready` が無いか、`status:in-progress`・`status:blocked-question`・`status:needs-human`・`kind:epic`・`kind:kaizen` が付いていれば、次へ。
2. `status:ready` を付けた人が書き込み権限を持つかを確かめる（Issue のイベントの最後の `labeled status:ready` の人を、GitHub MCP の `list_repository_collaborators` で見る）。持たなければ `status:ready` を外して `status:needs-human` を付け、理由をコメントして次へ。
3. Issue の受入条件と補足に、決まっていない点（「未決」「決めていない」「どちらにするか」「要確認」など、選び方で受入条件の結果が変わるもの）が残っていれば、着手させない。`status:ready` を外して `status:blocked-question` を付け、決めてほしいことを選択肢つきでコメント（先頭に `<!-- factory:<役> action=undecided -->`）して次へ（実装を起動しても、質問だけで止まるため）。Issue の後のコメントで答えが出ていれば、決まったものとして扱う。
4. 変えるファイル（テストを除く）を決める。受入条件から、変える画面・API・表を挙げ、`main` の最新を検索する（`src/lib/db/migrations.ts` も含める）。
5. `node scripts/factory/claim.ts precheck <番号> --files <カンマ区切りのパス>` を実行する。`decision` が `go` でなければ、`actions` のとおりにして次へ（`comment` が `null` ならコメントしない。`actions` が無い＝スクリプトが失敗したときは、その Issue には何もせず次へ）。
6. 難易度を判定する。次の 1 つでも当たれば「難しい」。
   - 元に戻しにくい（データの書き換え・削除、外部への送信）
   - 外部の利用者がいる（ほかのシステム・端末・集計が読む API や列）
   - 触る場所にテストが無く、理由の書かれていない分岐がある
   - まとめて処理する・同時に更新される・止められない処理が絡む
   - 認証・権限・お金が絡む
7. `actions` のとおりにする: `removeLabels` を外し、`addLabels`（難しければ代わりに `addLabelsIfHard`）を付け、`comment` を書く（難しければ、当たった観点を書き足す）。

`precheck` で待たせた分・未決で返した分だけ空きが残っていれば、もう一度だけ `pick` から繰り返す。

## 3. 起動しなかった実装を起こし直す

`node scripts/factory/claim.ts relabel --minutes 15` を実行する。

- `relabel` の Issue ごとに（2 件目からは 30 秒あけて）、その `label` を外して付け直し、`<!-- factory:dispatch action=relabel-start -->` でコメントする。
- `needsHuman` の Issue（2 回目）には触らない（巡回が人に回す）。

## 4. 途中で止まった実装を片付ける

対象は `claude/issue-` の PR と、その Issue だけ。`status:needs-human` の付いた PR と、Issue に `status:blocked-question`・`status:needs-human`・`kind:epic` があるものには触らない。コメントの先頭に `<!-- factory:dispatch action=<処置> -->` を付ける。

- CI（`app-check`）が成功した draft の PR が 15 分以上動いていない: PR を Ready にし、Issue の `status:in-progress` を外す（`ready-stalled`）。
- `status:in-progress` が付き、PR が無いか draft のまま、最後の動きから 60 分以上（上に当たらないもの）: `status:in-progress` を外し、経過をコメントして `status:needs-human` を付ける（`stalled`）。
- draft の PR の CI（`app-check`）が失敗か終わっておらず、Issue に `status:in-progress` が無く、最後の動きから 60 分以上: 経過をコメントして `status:needs-human` を付ける（`stalled-ci`）。

## 5. 終える

何かしたときだけ、した Issue・PR にコメントする。
