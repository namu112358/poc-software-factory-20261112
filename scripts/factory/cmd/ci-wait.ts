// `claim.ts ci-wait --pr <N> [--minutes 15] [--role implement|fix]`: PR の CI（app-check）が終わるまで待つ（result のとおりに動く。1 回に 16 分ほどかかるのでバックグラウンドで実行する）。

import { ciWaitStep, type CiWaitState } from "../core/ci-wait.ts";
import { stalledComment } from "../core/marks.ts";
import { REPO, arg, get, sessionUrl, sleep, type RawPull } from "./github.ts";

const CI_POLL_MS = Number(process.env.FACTORY_CI_POLL_MS ?? "30000");

/** PR の head・mergeable と、その head の app-check を 1 回読む。読めなければ ok: false（その回は飛ばす） */
async function readCiWait(n: number): Promise<{ ok: boolean; sha?: string; appCheck?: { status: string; conclusion: string | null } | null; mergeable?: boolean | null }> {
  try {
    const pr = await get<RawPull>(`/repos/${REPO}/pulls/${n}`);
    const sha = pr.data.head?.sha;
    if (pr.status !== 200 || !sha) return { ok: false };
    const runs = await get<{ check_runs?: { status: string; conclusion: string | null; started_at: string }[] }>(`/repos/${REPO}/commits/${sha}/check-runs?check_name=app-check`);
    if (runs.status !== 200) return { ok: false };
    const latest = (runs.data.check_runs ?? []).sort((a, b) => (a.started_at < b.started_at ? -1 : 1)).at(-1);
    return { ok: true, sha, appCheck: latest ? { status: latest.status, conclusion: latest.conclusion } : null, mergeable: pr.data.mergeable ?? null };
  } catch {
    return { ok: false };
  }
}

async function waitForCi(n: number, minutes: number, role: string) {
  if (!Number.isInteger(n)) throw new Error("--pr に PR の番号を指定する");
  if (!(minutes > 0)) throw new Error("--minutes には正の数を指定する");
  const start = Date.now();
  let state: CiWaitState = { sha: null, deadlineMs: start + minutes * 60_000, failures: 0 };
  for (;;) {
    const step = ciWaitStep(state, await readCiWait(n), Date.now());
    if (step.done) {
      const endedAt = new Date();
      const startedAt = new Date(start).toISOString();
      const comment =
        step.result === "timeout"
          ? stalledComment(role, "ci-timeout", `CI（app-check）が ${minutes} 分たっても終わらないので、待つのをやめる（待ち始め ${startedAt}、打ち切り ${endedAt.toISOString()}）。PR は draft のまま。`, sessionUrl())
          : null;
      return { pr: n, sha: step.sha, result: step.result, conclusion: step.conclusion, startedAt, endedAt: endedAt.toISOString(), waitedSeconds: Math.round((endedAt.getTime() - start) / 1000), comment };
    }
    state = step.state;
    await sleep(Math.max(0, Math.min(CI_POLL_MS, state.deadlineMs - Date.now()))); // 時間切れの時刻に最後の読み直しをする
  }
}

export function runCiWait() {
  return waitForCi(Number(arg("pr")), Number(arg("minutes") ?? "15"), arg("role") ?? "implement");
}
