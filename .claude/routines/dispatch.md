# 割り当ての手順書

`claude/` で始まるブランチの PR が閉じたとき（マージを含む）に起動します。マージの直後に起きる 2 つの変化と、起動しなかった実装を拾います。どれも、待たされる Issue・PR の側にはイベントが来ないためです。コードは書きません。

## 0. ほかの割り当てと重ならないようにする

起動のきっかけの PR が閉じた時刻を T として、`node scripts/factory/claim.ts handled --since <T>` を実行する。`handled` に挙がった Issue・PR は、T より後にほかの割り当てのセッションが処理したものなので、1〜4 で触らない（PR が続けて閉じると割り当てが同時に動き、同じ PR を二重に更新していたため。#220）。

## 1. 衝突した PR を修正に回す

開いている `claude/` の PR のうち、Ready で `main` と衝突しているもの（`mergeable` が false）を探す。見つかれば、衝突していることをコメントし（先頭に `<!-- factory:dispatch -->`）、PR を draft に戻す（修正の役が起動して `main` を取り込む）。`needs-human` が付いた PR には触らない。

`mergeable` は、マージの直後は計算中（`null`）のことがある。`null` なら 1 分ほど待って一度だけ読み直し、それでも `null` なら触らない（巡回が後で拾う）。

## 2. 遅れているだけの PR を更新する

Mergify のキューに入っている PR（チェック「Mergify Merge Queue」が、キューに入っている・実行中の状態のもの）は、Mergify がキューの中で `main` を取り込むので、触らない。それ以外の PR だけを対象にする。

開いている `claude/` の PR のうち、Ready で、衝突はしていないが `main` より遅れているもの（`mergeable_state` が `behind`）は、GitHub MCP の `update_pull_request_branch` でブランチを更新する（`main` を取り込む）。Ruleset が「`main` を取り込み済み」をマージの条件にしているため、更新しないと人がマージできない。更新は `main` を取り込むだけで中身を変えないので、レビューはやり直さない。`needs-human` が付いた PR には触らない。

## 3. キューから取り出す

`README.md` の「キュー」のとおり、`node scripts/factory/claim.ts pick` の結果に従って `queued` の Issue を取り出す。閉じた PR が依存先の Issue を閉じたときは、それを待っていた Issue が取り出せるようになっている。

## 4. 起動しなかった実装を起こし直す

開いている Issue のうち、`ready` か `ready:hard` が付いて 15 分以上たち、その後に実装の役のコメント（`factory:touch`・`factory:queued` など）も `in-progress` も付いていないものは、実装の起動のイベントが捨てられたものとして、付いていたラベルを外して同じラベルを付け直す（実装がもう一度起動する）。時刻は、Issue のイベント（REST の `GET /repos/{owner}/{repo}/issues/{number}/events`）の最後の `labeled` で見る。コメントの先頭に `<!-- factory:dispatch action=relabel-ready -->` を付ける。同じ Issue に、すでに `factory:dispatch action=relabel-ready` か `factory:patrol action=relabel-ready` のコメントがあれば、付け直さない（巡回が 2 回目として `needs-human` にする）。`epic`・`blocked:question`・`needs-human` の付いた Issue には触らない。巡回（1 時間ごと、30 分以上たったものだけ）より早く拾うため（#190。取りこぼされた Issue が 87 分止まった）。

## 5. 終える

何かしたときだけ、した Issue・PR にコメントする。何もしなければ、コメントせずに終える。
