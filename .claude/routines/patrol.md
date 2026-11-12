# 巡回の手順書

1 時間ごとに起動します。捨てられたイベント・途中で止まったセッション・PR どうしの衝突を拾い、割り当ての役の代わりに待っている Issue に着手もさせます。コードは書きません。以下の `status:in-progress` は `status:in-progress-hard` も含みます。

## 1. 取りこぼしを拾う

対象は、最後に状態が変わってから 30 分以上たったもの（表に別の時間があればそれに従う）。PR は `claude/issue-` のものだけ（ほかの `claude/` の PR は、出したセッションが扱う）。人を待っているもの（PR に `status:needs-human`、または Issue に `status:blocked-question`・`status:needs-human`）は対象にしない。したことは `<!-- factory:patrol action=<したこと> -->` でコメントする。同じものに同じことをするのは 1 回まで。2 回目は `status:needs-human` を付けて理由をコメントする。

まず `node scripts/factory/claim.ts relabel --minutes 30` を実行する。`relabel` の Issue は（2 件目からは 30 秒あけて）その `label` を外して付け直し（`relabel-start`）、`needsHuman` の Issue は `status:in-progress` を外して `status:needs-human` を付ける。

| 状態 | すること |
|---|---|
| `claude/issue-<番号>` の draft の PR で、CI（`app-check`）が成功、最新のレビューの後に「取り込みだけのコミット」でないコミットがある（レビューが無ければよい）、`main` と衝突していない、最後の動きから 15 分以上 | PR を Ready にし、Issue の `status:in-progress` を外す |
| Issue に `status:in-progress`、PR が無いか draft のまま（上に当たらないもの）、最後の動き（コメント・コミット・ラベルの変化）から 60 分以上 | `status:in-progress` を外し、経過をコメントして `status:needs-human` を付ける |
| draft の PR の CI（`app-check`）が失敗か終わっておらず、Issue に `status:in-progress` が無く、最後の動きから 60 分以上（下の 2 行に当たらないもの） | 経過をコメントして `status:needs-human` を付ける |
| Ready の PR に、最新のコミットに対するレビュー（`commit=`）が無い（最新の `verdict=ok` の後が「取り込みだけのコミット」だけなら対象外） | PR を draft にしてから Ready に戻す |
| draft の PR で、最新のレビューが `verdict=changes` で `commit=` が最新のコミット | `status:needs-human` を付けて理由をコメントする |
| draft の PR が `main` と衝突している | PR を Ready にしてから draft に戻す |
| Ready の PR が `main` と衝突している | 衝突していることをコメントし、draft に戻す |
| 閉じた Issue に `status:in-progress` が残っている | `status:in-progress` を外す |

## 2. 待っている Issue に着手させる

`dispatch.md` の「2. 待っている Issue に着手させる」と同じことをする。`pick` が `error` なら、出力を集計のコメントに書く。

## 3. 集計する

Issue「Factory の運用の記録」に、開いている Issue・PR の数（状態ごと）と、この 1 時間にしたことをコメントする。前回から変化が無ければコメントしない。`docs/` は変えない。
