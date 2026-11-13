# scripts/factory

Routine（`.claude/routines/`）が使う判定のスクリプトです。GitHub を読むだけで、書き込みはしません。役はスクリプトを実行し、出力（`decision`・`actions`・`comment`）のとおりにラベルとコメントを変えます。判定の決まりはここに書き、手順書には書きません。役が扱う PR は、このリポジトリのブランチで名前が `claude/` で始まるものだけです（フォークの PR は、ブランチ名が `claude/...` でも対象にしない）。Routine はこのディレクトリを変えません。

## コマンド

| コマンド | 使う役 | 出すもの |
|---|---|---|
| `pick` | 割り当て・巡回 | 着手させる候補（`pick`）と、待ち先を付け替える Issue（`rewait` とその `comment`）。空き・budget の残り |
| `precheck <番号> --files a,b` | 割り当て・巡回 | 候補 1 件を着手させてよいか（`go` / `queue` / `error`）と、そのまま行う操作（`actions`） |
| `relabel --minutes N` | 割り当て（15）・巡回（30） | 起動しなかった実装の付け直しの対象（`relabel`）と、2 回目で人に回すもの（`needsHuman`） |
| `stalled --role dispatch\|patrol` | 割り当て・巡回 | 止まった実装・PR の片付け。衝突した PR・レビューが動かなかった PR・CI が通ったまま止まった draft・作業中のまま止まった Issue・CI が通らないまま止まった draft・Mergify の時間切れ・閉じた Issue に残った起動のラベルを、行の順に最初に当たった 1 つだけ判定し、`actions`（`target`・`action`・`removeLabels`・`addLabels`・`draft`・`issue`・`comment`）に出す。`mergeable` が `null` の PR は `unknown`（1 分後に 1 回だけ実行し直す）。PR は `claude/` のもの（`claude/issue-` 以外は衝突だけ）。人を待っているもの（`status:needs-human` の PR、Issue に `status:blocked-question`・`status:needs-human`・`kind:epic`）は対象にしない |
| `gate --role implement\|review\|fix --number N` | 実装・レビュー・修正 | 起動してよいか（`decision`: `stop` / `takeover` / `lock` / `go` / `needs-human`）と理由、引き継ぐ PR（`pr`）、ブランチ（`branch`）、そのまま行う書き込み（`ops`）。PR の head がこのリポジトリのブランチでない（フォーク。null を含む）ものは、レビュー・修正が `stop`、実装は引き継がず、着手を止める理由にも数えない。レビューは `light`（軽い再レビュー）と `riskFiles`、修正は `fix`（`changes`・`conflict`・`removeMergeRequested`）と、`changes` のレビューが 3 つ以上なら `needs-human`（`ops`）も返す。実装は、着手のコメントがある・`Closes` の PR がある・ブランチだけがある（60 秒待って読み直す）を順に判定し、どれでもなければ `lock`（役が `create_branch` で鍵を作る）。起動のラベルを付けた人は `labeler` に出すだけで、書き込み権限は役が確かめる |
| `handled --since <時刻>` | 割り当て | ほかの割り当てのセッションが、その時刻より後に処理した Issue・PR |
| `budget` | （確かめ用） | 直近 60 分に `status:in-progress`・`status:in-progress-hard` を付けた回数と、残り |
| `review-status <PR>` | GitHub Actions（`.github/workflows/factory-review-status.yml`。main の定義で動くきっかけだけで起動する） | レビューを通ったことを表す status（`factory-review`）の値。`merge-check` のレビューの部分と同じ判定で `ok` なら `success`（`risk:high` の PR と、品質のゲート〔CI の動きを決めるファイル・Mergify・手順書・判定のスクリプト・規約・Ruleset。一覧は `GATE_PATHS`〕を変える PR は付けない）、最新のコミットへのレビューが ok でなければ `failure`、それ以外は `null`（付けない）。Mergify は `risk:high` 以外の PR を、これが `success` ならキューに入れる |
| `merge-check <PR>` | 人（`merge:requested` を付ける前） | `merge:requested` を付けてよいか（`ok`）と理由。最新の `factory:review` が `verdict=ok` で、そのコミットより後が「取り込みだけのコミット」（`git show --remerge-diff` の差分が空）だけで、最新のコミットの `app-check`・`pr-body-check`（キューに入る条件）が成功していれば `ok` |

`node scripts/factory/claim.ts <コマンド>` で動かす（Node 22.18 以上。クラウドのプロキシを通すため、自分を `NODE_USE_ENV_PROXY=1` で起動し直す）。`decision` が `error` のときは終了コード 2。

## 決まり

- **同時に実装する Issue は 4 件まで**（`WIP_LIMIT`）。`status:in-progress` か `status:in-progress-hard` の付いた開いている Issue の数で数える。
- **待っている Issue**: `status:ready` があり、`status:in-progress`・`status:in-progress-hard`・`status:blocked-question`・`status:needs-human`・`kind:epic`・`kind:kaizen` の無い開いている Issue。待つ理由は、割り当ての役が `<!-- factory:queued wait=<#番号|slot> files=<ファイル> -->` のコメントで書く（コード上は queued と呼ぶ）。
- **依存先**: blocked by に登録された Issue、本文の「#N の後」、待ちの記録の `wait=#N`（同じファイル待ち）。同じファイル待ちは、待ち先が人を待っている（`status:needs-human`・`status:blocked-question`）・待ち先の今のファイルと重ならなくなった・待ち先が待っているだけの Issue、のどれかなら待ち終わりとする。`wait=slot`（空き待ち）は依存先ではない。人が決めた依存（blocked by・「#N の後」）は、どの例外にもしない。
- **`precheck`**: 依存先が開いていれば待つ。自分以外の作業中が 4 件以上なら空き待ち。変えるファイルが、開いている `claude/` の PR（自分の PR と人待ちの PR を除く）・作業中の Issue の `factory:touch`・自分より先に待ち始めた先頭の Issue と重なれば、その相手を待つ。この Issue の PR がもう開いていれば `go`（引き継ぐ）。最初に自分の Issue のラベルを読み直し、`status:ready` が無い・作業中や人待ちの印・`kind:epic`・`kind:kaizen` が付いていれば `skip`（何もしない。#322）。`go` の着手のコメント（`factory:touch`）には、同じファイルを予定して先に待っている Issue を `ahead=` に残す（空なら自分が先頭。追い越しを記録から数えるため。#183）。
- **不具合の直しを先に**: `main` の最新のコミットの `app-check` が失敗しているときは、`type:fix` の Issue を、同じファイルの待ち（開いている PR・作業中・先に待っている Issue）より先に着手させる（`pick` では待ち始めの順より前に並べる）。依存先と、同時に実装する数の上限は守る。`main` の CI を壊した不具合の直しが、壊れた PR と同じファイルを待って止まったため（#363）。
- **`pick`**: 空き（4 − 作業中）と budget の残りの小さいほうの数だけ、依存先の閉じた待っている Issue を、待ち始めの早い順（最初の `factory:queued` の時刻。待ったことが無いものは後ろ、番号の小さい順）に選ぶ。先頭どうし・開いている PR・作業中の Issue・同じ回に選んだ Issue とファイルが重なるものは、選ばずに `rewait` に入れる（待ち先が今と同じなら入れない）。
- **budget**: 実装の Routine は 1 時間あたりの起動の上限を超えると、起動のイベントが捨てられる（数値は非公開）。直近 60 分の起動のきっかけを 45 回（`READY_EVENTS_PER_HOUR_BUDGET`）までにする。2026-11-12 は 53〜55 回で止まった（#250）。
- **`relabel`**: `status:in-progress` が付いて N 分以上たち、その後に実装の着手のコメント（`factory:implement action=start`）も PR も無いもの。付け直しは 1 回まで（`relabel-start` のコメントがあれば `needsHuman`）。
- **`handled`**: PR が続けて閉じると割り当てが同時に動くので、ほかのセッションが先に処理したものを飛ばす。ほぼ同時に始まった 2 つは防げない。

## 人の手順: merge:requested を付ける前

レビューを通った PR は、`risk:high` と品質のゲートを変える PR 以外は自動でキューに入る（`review-status`）。人が `merge:requested` を付けるのは、`risk:high` の PR・品質のゲートを変える PR・自動で入らなかった PR（キューから外れたものなど）だけ。


PR に `merge:requested` を付ける前に、必ず `node scripts/factory/claim.ts merge-check <PR>` を実行し、`ok` が `true` のときだけ付ける。`false` なら `reason` のとおりにする（レビューを起こし直す、など）。レビューの ok が無いまま `merge:requested` が付いた PR が 4 本あったため（#293）。キューを通さずにマージするとき（`.mergify.yml` を変える PR など）も、マージの前に同じように実行する（#323 は、レビューの後に足した衝突の解消が未レビューのままマージされた）。

`merge:requested` は、今のラベルに**足して**付ける（REST の `POST /repos/{owner}/{repo}/issues/{番号}/labels`）。GitHub MCP の `issue_write` の `labels` はラベルを丸ごと置き換えるので、ほかの役が付けた `risk:high` などを消してしまう（#400）。`issue_write` を使うときは、直前に今のラベルを読み直し、全部を含めて渡す。

## 人の手順: 最初に動かすとき

割り当ての Routine は、PR が閉じたときと、Issue に `status:ready` が付いたとき（#357。トリガーの設定はユーザー）に動く。承認のトリガーがまだ無い環境で作業中が 0 件のときは、人（有人のセッション）が `pick` を実行し、`.claude/routines/dispatch.md` の「1.」と同じ手順で `status:in-progress`（`status:in-progress-hard`）を付ける。その後は、PR が閉じるたびに割り当てが、1 時間ごとに巡回が着手させる。
