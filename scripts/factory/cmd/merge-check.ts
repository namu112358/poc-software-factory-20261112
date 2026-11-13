// `claim.ts merge-check <PR>`: merge:requested のラベルを付けてよいか（最新のレビューが ok で、その後は取り込みだけか）。

import { ciCheck } from "../core/checks.ts";
import { REPO, get } from "./github.ts";
import { reviewCheck } from "./review-check.ts";

export async function runMergeCheck(n: number) {
  if (!Number.isInteger(n)) throw new Error("PR の番号を指定する");
  const pr = (await get<{ head: { sha: string } }>(`/repos/${REPO}/pulls/${n}`)).data;
  const review = await reviewCheck(n, pr.head.sha);
  if (!review.ok) return { pr: n, ...review };
  // レビューが ok でも、キューに入る条件のチェックが落ちていればキューに入らない（#364）
  const runs = (
    await get<{ check_runs: { name: string; status: string; conclusion: string | null; started_at: string }[] }>(`/repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=100`)
  ).data.check_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, startedAt: r.started_at }));
  const ci = ciCheck(runs);
  return { pr: n, ...review, ...(ci.ok ? {} : { ok: false, reason: ci.reason }) };
}
