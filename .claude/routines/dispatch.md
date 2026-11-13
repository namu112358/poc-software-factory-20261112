# 割り当ての手順書

`claude/` の PR が閉じたとき（マージを含む）と、Issue に `status:ready` が付いたとき（人の承認）に起動します。待っている Issue に実装を始めさせ、マージの後の衝突・起動しなかった実装・止まった実装を拾います。コードは書きません。以下の `status:in-progress` は `status:in-progress-hard` も含みます。

## 0. ほかの割り当てと重ならないようにする

きっかけの時刻（PR が閉じた時刻、または `status:ready` が付いた時刻）を T として `node scripts/factory/claim.ts handled --since <T>` を実行し、`handled` の Issue・PR には 1〜3 で触らない。`error` なら、この確かめを飛ばす。

`status:ready` が付いて起動したときは、「1.」だけを行う（承認されてすぐ着手させるため。#357）。そのとき、きっかけの Issue に最後にラベルが付いてから 30 秒たつまで待ってから始める（同じ数秒にほかのラベルも付くと、実装が重ねて起動する。#429）。

## 1. 待っている Issue に着手させる

`node scripts/factory/claim.ts pick` を実行する（`error` なら、出力を終えるコメントに書いて 2 へ）。`rewait` の Issue には、その `comment` をそのままコメントする。

`pick` の Issue ごとに、順に次を行う。2 件目からは、前の 1 件にラベルを付けてから 30 秒あける（`node -e "setTimeout(() => {}, 30000)"`）。

1. ラベルを読み直し、`status:ready` が無いか、`status:in-progress`・`status:blocked-question`・`status:needs-human`・`kind:epic`・`kind:kaizen` が付いていれば、次へ。
2. `status:ready` を付けた人が書き込み権限を持つかを確かめる（Issue のイベントの最後の `labeled status:ready` の人を、GitHub MCP の `list_repository_collaborators` で見る）。持たなければ `status:ready` を外して `status:needs-human` を付け、理由をコメントして次へ。
3. Issue の受入条件と補足に、決まっていない点（「未決」「決めていない」「どちらにするか」「要確認」など、選び方で受入条件の結果が変わるもの）が残っていれば、着手させない。`status:ready` を外して `status:blocked-question` を付け、決めてほしいことを選択肢つきでコメント（先頭に `<!-- factory:<役> action=undecided -->`）して次へ（実装を起動しても、質問だけで止まるため）。Issue の後のコメントで答えが出ていれば、決まったものとして扱う。
4. 変えるファイル（テストを除く）を決める。受入条件から、変える画面・API・表を挙げ、`main` の最新を検索する（`src/lib/db/migrations.ts` も含める）。
5. 難易度を判定する。次の 1 つでも当たれば「難しい」。
   - 元に戻しにくい（データの書き換え・削除、外部への送信）
   - 外部の利用者がいる（ほかのシステム・端末・集計が読む API や列）
   - 触る場所にテストが無く、理由の書かれていない分岐がある
   - まとめて処理する・同時に更新される・止められない処理が絡む
   - 認証・権限・お金が絡む
6. `node scripts/factory/claim.ts precheck <番号> --files <カンマ区切りのパス>` を実行する。ラベルを付ける直前に実行し、間にほかの作業を挟まない（`precheck` はラベルを読み直し、`status:ready` が無い・作業中や人待ちの印・`kind:epic`・`kind:kaizen` があれば `skip` を返す。#322）。`decision` が `go` でなければ（`skip` を含む）、`actions` のとおりにして次へ（`comment` が `null` ならコメントしない。`actions` が無い＝スクリプトが失敗したときは、その Issue には何もせず次へ）。
7. すぐに `actions` のとおりにする: `removeLabels` を外し、`addLabels`（難しければ代わりに `addLabelsIfHard`）を付け、`comment` を書く（難しければ、当たった観点を書き足す）。

`precheck` で待たせた分・未決で返した分だけ空きが残っていれば、もう一度だけ `pick` から繰り返す。

## 2. 起動しなかった実装を起こし直す

`node scripts/factory/claim.ts relabel --minutes 15` を実行する。

- `relabel` の Issue ごとに（2 件目からは 30 秒あけて）、その `label` を外して付け直し、`<!-- factory:dispatch action=relabel-start -->` でコメントする。
- `needsHuman` の Issue（2 回目）には触らない（巡回が人に回す）。

## 3. 止まった実装・PR を片付ける

`node scripts/factory/claim.ts stalled --role dispatch` を実行し、`actions` を上から順に（2 件目からは 30 秒あけて）そのとおりにする。`target` の PR か Issue に対し、`removeLabels` を外し、`addLabels` を付け、`draft` の指定どおりに draft と Ready を切り替え（`draft-then-ready` は draft にしてから Ready、`ready-then-draft` は Ready にしてから draft）、`issue` があればその Issue のラベルも同じように変え、`comment` をそのまま書く（`null` ならコメントしない）。`unknown` の PR は、1 分待って 1 回だけ実行し直す。

## 4. 終える

何かしたときだけ、した Issue・PR にコメントする。
