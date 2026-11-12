# 割り当ての手順書

`claude/` で始まるブランチの PR が閉じたとき（マージを含む）に起動します。マージの直後に起きる 2 つの変化と、起動しなかった実装・途中で止まった実装を拾います。どれも、待たされる Issue・PR の側にはイベントが来ないためです。コードは書きません。

## 0. ほかの割り当てと重ならないようにする

起動のきっかけの PR が閉じた時刻を T として、`node scripts/factory/claim.ts handled --since <T>` を実行する。`handled` に挙がった Issue・PR は、T より後にほかの割り当てのセッションが処理したものなので、1〜5 で触らない（PR が続けて閉じると割り当てが同時に動き、同じ PR を二重に更新していたため。#220）。2 つの割り当てがほぼ同時に始まると、どちらもまだ相手のコメントが無いので防げない（片方が終わってから始まる重なりだけを防ぐ）。`handled` が `error` なら、この確かめを飛ばして 1 から進める（二重になっても、それぞれの処理は読み直してから行うので壊れない）。

## 1. 衝突した PR を修正に回す

開いている `claude/` の PR のうち、Ready で `main` と衝突しているもの（`mergeable` が false）を探す。見つかれば、衝突していることをコメントし（先頭に `<!-- factory:dispatch -->`）、PR を draft に戻す（修正の役が起動して `main` を取り込む）。`needs-human` が付いた PR には触らない。

`mergeable` は、マージの直後は計算中（`null`）のことがある。`null` なら 1 分ほど待って一度だけ読み直し、それでも `null` なら触らない（巡回が後で拾う）。

## 2. 遅れているだけの PR は更新しない

衝突はしていないが `main` より遅れているだけの PR（`mergeable_state` が `behind`）には触らない。`merge` のラベルが付くと、Mergify のキューが PR の上で `main` を取り込み、CI を回し直してからマージする（「その場」方式。#71）。ラベルを待っている PR を更新しても、マージには役立たず、取り込みのコミットと CI の回数が増えるだけだった（レビューを通った PR に、取り込みだけのコミットが 9 個ずつ付いた。#247）。

## 3. キューから取り出す

`README.md` の「キュー」のとおり、`node scripts/factory/claim.ts pick` の結果に従って `queued` の Issue を取り出す。`pick` が `error` なら取り出さず、出力を終えるコメントに書く（巡回が後で取り出す）。閉じた PR が依存先の Issue を閉じたときは、それを待っていた Issue が取り出せるようになっている。

## 4. 起動しなかった実装を起こし直す

開いている Issue のうち、`ready` か `ready:hard` が付いて 15 分以上たち、その後に実装の役のコメント（`factory:touch`・`factory:queued` など）も `in-progress` も付いていないものは、実装の起動のイベントが捨てられたものとして、付いていたラベルを外して同じラベルを付け直す（実装がもう一度起動する）。時刻は、Issue のイベント（REST の `GET /repos/{owner}/{repo}/issues/{number}/events`）の最後の `labeled` で見る。コメントの先頭に `<!-- factory:dispatch action=relabel-ready -->` を付ける。同じ Issue に、すでに `factory:dispatch action=relabel-ready` か `factory:patrol action=relabel-ready` のコメントがあれば、付け直さない（巡回が 2 回目として `needs-human` にする）。`epic`・`blocked:question`・`needs-human` の付いた Issue には触らない。巡回（1 時間ごと、30 分以上たったものだけ）より早く拾うため（#190。取りこぼされた Issue が 87 分止まった）。

## 5. 途中で止まった実装を片付ける

巡回の表の次の 3 行に当たるものを、巡回と同じように片付ける。対象外の決まりも巡回と同じ: PR は head のブランチが `claude/` で始まるものだけ。`needs-human` の付いた PR と、`Closes` で参照する Issue に `blocked:question`・`needs-human`・`epic` が付いているものには触らない。コメントの先頭に `<!-- factory:dispatch action=<した処置> -->` を付ける。

- CI が成功した draft の PR が 15 分以上動いていない（PR を Ready にする直前で止まった）: PR を Ready にし、Issue に `in-progress` が残っていれば外す（`action=ready-stalled`）。
- `in-progress` が付き、PR が無いか draft のまま、最後の動きから 60 分以上（上に当たらないもの）: `in-progress` を外し、経過をコメントして `needs-human` を付ける（`action=stalled`）。
- draft の PR の最新のコミットの CI が失敗しているか終わっておらず、Issue に `in-progress` が無く、最後の動きから 60 分以上（実装が CI を待ちきれずに終えた後、CI が落ちたもの）: 経過をコメントして `needs-human` を付ける（`action=stalled-ci`）。

止まった実装が `in-progress` のまま、同時に実装する枠（4 件）を塞ぎ続けないため（#215・#219。利用上限で止まった 3 件が、CI は通っていたのに 2 時間近く枠を塞いだ）。

## 6. 終える

何かしたときだけ、した Issue・PR にコメントする。何もしなければ、コメントせずに終える。
