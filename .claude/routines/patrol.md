# 巡回の手順書

1 時間ごとに起動します。捨てられたイベント・途中で止まったセッション・PR どうしの衝突を拾い、割り当ての役の代わりに待っている Issue に着手もさせます。コードは書きません。以下の `status:in-progress` は `status:in-progress-hard` も含みます。

## 1. 取りこぼしを拾う

まず `node scripts/factory/claim.ts relabel --minutes 30` を実行する。`relabel` の Issue は（2 件目からは 30 秒あけて）その `label` を外して付け直し（`<!-- factory:patrol action=relabel-start -->` でコメントする）、`needsHuman` の Issue は `status:in-progress` を外して `status:needs-human` を付け、理由をコメントする。

その後 `node scripts/factory/claim.ts stalled --role patrol` を実行し、`actions` を上から順に（2 件目からは 30 秒あけて）そのとおりにする。`target` の PR か Issue に対し、`removeLabels` を外し、`addLabels` を付け、`draft` の指定どおりに draft と Ready を切り替え（`draft-then-ready` は draft にしてから Ready、`ready-then-draft` は Ready にしてから draft）、`issue` があればその Issue のラベルも同じように変え、`comment` をそのまま書く（`null` ならコメントしない）。`unknown` の PR は、1 分待って（`node scripts/factory/claim.ts wait 60`）1 回だけ実行し直す。

## 2. 待っている Issue に着手させる

`dispatch.md` の「1. 待っている Issue に着手させる」と同じことをする。`pick` が `error` なら、出力を集計のコメントに書く。

## 3. 集計する

Issue「Factory の運用の記録」に、開いている Issue・PR の数（状態ごと）と、この 1 時間にしたことをコメントする。前回から変化が無ければコメントしない。前回の集計は REST の `GET /repos/{owner}/{repo}/issues/<番号>/comments?since=<2 時間前>` で読む（`node scripts/factory/claim.ts rest-get /repos/namu112358/poc-software-factory-20261112/issues/<番号>/comments?since=<2 時間前>` を実行する。`gh api`・`curl` は許可に当たらず承認の画面に回る。GitHub MCP では先頭のコメントしか取れず、変化を判断できずに書かずに終えた。22:35・23:35）。読めなければ、変化があったものとしてコメントする。`docs/` は変えない。
