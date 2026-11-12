# scripts/factory

Routine（`.claude/routines/`）が使う判定のスクリプトです。GitHub を読むだけで、書き込みはしません。役はスクリプトを実行し、出力（`decision`・`actions`・`comment`）のとおりにラベルとコメントを変えます。判定の決まりはここに書き、手順書には書きません。Routine はこのディレクトリを変えません。

## コマンド

| コマンド | 使う役 | 出すもの |
|---|---|---|
| `pick` | 割り当て・巡回 | 着手させる候補（`pick`）と、待ち先を付け替える Issue（`rewait` とその `comment`）。空き・budget の残り |
| `precheck <番号> --files a,b` | 割り当て・巡回 | 候補 1 件を着手させてよいか（`go` / `queue` / `error`）と、そのまま行う操作（`actions`） |
| `relabel --minutes N` | 割り当て（15）・巡回（30） | 起動しなかった実装の付け直しの対象（`relabel`）と、2 回目で人に回すもの（`needsHuman`） |
| `handled --since <時刻>` | 割り当て | ほかの割り当てのセッションが、その時刻より後に処理した Issue・PR |
| `budget` | （確かめ用） | 直近 60 分に `status:in-progress`・`status:in-progress-hard` を付けた回数と、残り |
| `merge-check <PR>` | 人（`merge:requested` を付ける前） | `merge:requested` を付けてよいか（`ok`）と理由。最新の `factory:review` が `verdict=ok` で、そのコミットより後が「取り込みだけのコミット」（`git show --remerge-diff` の差分が空）だけなら `ok` |

`node scripts/factory/claim.ts <コマンド>` で動かす（Node 22.18 以上。クラウドのプロキシを通すため、自分を `NODE_USE_ENV_PROXY=1` で起動し直す）。`decision` が `error` のときは終了コード 2。

## 決まり

- **同時に実装する Issue は 4 件まで**（`WIP_LIMIT`）。`status:in-progress` か `status:in-progress-hard` の付いた開いている Issue の数で数える。
- **待っている Issue**: `status:ready` があり、`status:in-progress`・`status:in-progress-hard`・`status:blocked-question`・`status:needs-human`・`kind:epic`・`kind:kaizen` の無い開いている Issue。待つ理由は、割り当ての役が `<!-- factory:queued wait=<#番号|slot> files=<ファイル> -->` のコメントで書く（コード上は queued と呼ぶ）。
- **依存先**: blocked by に登録された Issue、本文の「#N の後」、待ちの記録の `wait=#N`（同じファイル待ち）。同じファイル待ちは、待ち先が人を待っている（`status:needs-human`・`status:blocked-question`）・待ち先の今のファイルと重ならなくなった・待ち先が待っているだけの Issue、のどれかなら待ち終わりとする。`wait=slot`（空き待ち）は依存先ではない。人が決めた依存（blocked by・「#N の後」）は、どの例外にもしない。
- **`precheck`**: 依存先が開いていれば待つ。自分以外の作業中が 4 件以上なら空き待ち。変えるファイルが、開いている `claude/` の PR（自分の PR と人待ちの PR を除く）・作業中の Issue の `factory:touch`・自分より先に待ち始めた先頭の Issue と重なれば、その相手を待つ。この Issue の PR がもう開いていれば `go`（引き継ぐ）。
- **`pick`**: 空き（4 − 作業中）と budget の残りの小さいほうの数だけ、依存先の閉じた待っている Issue を、待ち始めの早い順（最初の `factory:queued` の時刻。待ったことが無いものは後ろ、番号の小さい順）に選ぶ。先頭どうし・開いている PR・作業中の Issue・同じ回に選んだ Issue とファイルが重なるものは、選ばずに `rewait` に入れる（待ち先が今と同じなら入れない）。
- **budget**: 実装の Routine は 1 時間あたりの起動の上限を超えると、起動のイベントが捨てられる（数値は非公開）。直近 60 分の起動のきっかけを 45 回（`READY_EVENTS_PER_HOUR_BUDGET`）までにする。2026-11-12 は 53〜55 回で止まった（#250）。
- **`relabel`**: `status:in-progress` が付いて N 分以上たち、その後に実装の着手のコメント（`factory:implement action=start`）も PR も無いもの。付け直しは 1 回まで（`relabel-start` のコメントがあれば `needsHuman`）。
- **`handled`**: PR が続けて閉じると割り当てが同時に動くので、ほかのセッションが先に処理したものを飛ばす。ほぼ同時に始まった 2 つは防げない。

## 人の手順: merge:requested を付ける前

PR に `merge:requested` を付ける前に、必ず `node scripts/factory/claim.ts merge-check <PR>` を実行し、`ok` が `true` のときだけ付ける。`false` なら `reason` のとおりにする（レビューを起こし直す、など）。レビューの ok が無いまま `merge:requested` が付いた PR が 4 本あったため（#293）。キューを通さずにマージするとき（`.mergify.yml` を変える PR など）も、マージの前に同じように実行する（#323 は、レビューの後に足した衝突の解消が未レビューのままマージされた）。

## 人の手順: 最初に動かすとき

割り当ての Routine は PR が閉じたときにしか動かない。作業中が 0 件のときは、人（有人のセッション）が `pick` を実行し、`.claude/routines/dispatch.md` の「2.」と同じ手順で `status:in-progress`（`status:in-progress-hard`）を付ける。その後は、PR が閉じるたびに割り当てが、1 時間ごとに巡回が着手させる。
