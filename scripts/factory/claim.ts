// Factory の Routine が使う判定のスクリプト（GitHub を読むだけ。書き込みはしない）。
// 使い方（結果は JSON で標準出力に出る。役は decision に従い、ラベルとコメントを GitHub MCP で変える）:
//   node scripts/factory/claim.ts pick                                  待っている Issue（status:ready あり・status:in-progress なし）のうち、着手させる候補
//   node scripts/factory/claim.ts precheck <Issue> --files a.ts,b.ts   候補 1 件を着手させてよいかの確かめ（actions に、そのまま行う操作）
//   node scripts/factory/claim.ts relabel --minutes 15                  起動しなかった実装の付け直しの対象（付け直す数は budget の残りまで）
//   node scripts/factory/claim.ts handled --since <ISO 8601>            ほかの割り当てがもう処理した Issue・PR
//   node scripts/factory/claim.ts merge-check <PR>                      merge:requested のラベルを付けてよいか（最新のレビューが ok で、その後は取り込みだけか）
//   node scripts/factory/claim.ts review-status <PR>                    レビューの結果の status の値（state: 自動でキューに入ってよいか〔factory-review〕、reviewed: 最新のコミットがレビューを通ったか〔factory-reviewed〕）。GitHub Actions が使う
//   node scripts/factory/claim.ts stalled --role dispatch|patrol       止まった実装・PR の片付け（actions に、そのまま行う操作。unknown は 1 分後にもう一度）
//   node scripts/factory/claim.ts gate --role implement|review|fix --number <N>   実装・レビュー・修正が起動してよいか（decision と、役が行う ops）
//   node scripts/factory/claim.ts ci-wait --pr <N> [--minutes 15] [--role implement|fix]   PR の CI（app-check）が終わるまで待つ（result のとおりに動く。1 回に 16 分ほどかかるのでバックグラウンドで実行する）
//   node scripts/factory/claim.ts budget                                直近 60 分に status:in-progress を付けた回数と、あと何回付けてよいか
//   node scripts/factory/claim.ts wait <秒>                              指定の秒数（1〜600）だけ待つ（GitHub は読まない。単独の sleep は Claude Code に断られるため）
//   node scripts/factory/claim.ts session-id                            このセッションの ID（session_...）と URL（コメントの最後の行・コミットの Claude-Session: に書く）
//   node scripts/factory/claim.ts rest-get /repos/<repo>/<パス>          このリポジトリの REST を GET で読む（一覧は全ページ。gh api・curl は許可に当たらないため）
// Node 22.18 以上（型を外して .ts をそのまま動かす）。クラウドのプロキシを通すため、NODE_USE_ENV_PROXY=1 で自分を起動し直す。
//
// このファイルは入口だけ（引数を見て、サブコマンドごとのファイル cmd/<名前>.ts の関数を呼ぶ）。判定は core/、GitHub の読み取りは cmd/ にある。
// サブコマンドを直すときは、その cmd/・core/ のファイルを直し、ここには足さない（手順書・settings.json の許可が `node scripts/factory/claim.ts *` を前提にしているため、入口は変えない）。
import { spawnSync } from "node:child_process";
import { errorActions } from "./core/precheck.ts";
import { loadBudget } from "./cmd/budget.ts";
import { runCiWait } from "./cmd/ci-wait.ts";
import { runGate } from "./cmd/gate.ts";
import { arg } from "./cmd/github.ts";
import { runHandled } from "./cmd/handled.ts";
import { runMergeCheck } from "./cmd/merge-check.ts";
import { runPick } from "./cmd/pick.ts";
import { runPrecheck } from "./cmd/precheck.ts";
import { runRelabel } from "./cmd/relabel.ts";
import { runRestGet } from "./cmd/rest-get.ts";
import { runReviewStatus } from "./cmd/review-status.ts";
import { runSessionId } from "./cmd/session-id.ts";
import { runStalled } from "./cmd/stalled.ts";
import { runWait } from "./cmd/wait.ts";

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" },
  });
  process.exit(r.status ?? 1);
}

async function main(): Promise<unknown> {
  const [cmd, num] = process.argv.slice(2);
  const n = Number(num);
  switch (cmd) {
    case "precheck":
      return runPrecheck(n);
    case "pick":
      return runPick();
    case "budget":
      return loadBudget();
    case "merge-check":
      return runMergeCheck(n);
    case "ci-wait":
      return runCiWait();
    case "gate":
      return runGate(arg("role"), Number(arg("number")));
    case "review-status":
      return runReviewStatus(n);
    case "stalled":
      return runStalled(arg("role"));
    case "relabel":
      return runRelabel();
    case "handled":
      return runHandled();
    case "wait":
      return runWait(num);
    case "rest-get":
      return runRestGet(num);
    case "session-id":
      return runSessionId();
    default:
      throw new Error("pick / precheck / relabel / stalled / gate / ci-wait / handled / budget / merge-check / review-status / wait / session-id / rest-get のどれかを指定する");
  }
}

main().then(
  (r) => {
    const res = r as { decision?: string; reason?: string; actions?: unknown };
    if (res.decision === "error" && !res.actions) res.actions = errorActions(res.reason ?? "");
    console.log(JSON.stringify(r, null, 2));
    // decision が error（記録が無いなど）のときも、例外のときと同じ終了コード 2 にそろえる
    if ((r as { decision?: string }).decision === "error") process.exit(2);
  },
  (e: unknown) => {
    console.log(JSON.stringify({ decision: "error", reason: e instanceof Error ? e.message : String(e) }, null, 2));
    process.exit(2);
  },
);
