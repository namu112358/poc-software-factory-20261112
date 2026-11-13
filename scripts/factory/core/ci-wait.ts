// CI の待ちの 1 回分の判定（`claim.ts ci-wait`）。

export type CiWaitResult = "success" | "failure" | "conflict" | "head-changed" | "timeout" | "error";
export type CiWaitState = { sha: string | null; deadlineMs: number; failures: number }; // sha: 待ち始めの head（最初の読み取りで決まる）
/** 1 回の読み取り。ok が false のときは読めなかった回（ネットワーク）。appCheck は head の app-check（まだ無ければ null） */
export type CiWaitRead = { ok: boolean; sha?: string; appCheck?: { status: string; conclusion: string | null } | null; mergeable?: boolean | null };
export const CI_WAIT_MAX_FAILURES = 5;

/**
 * CI の待ち（implement.md の 4.・fix.md の 5.）の 1 回分の判定。終わりなら result を、続けるなら次の state を返す。
 * 順: 読み取りの失敗 5 回 → error / head が変わった → head-changed / app-check が終わった → success・failure / mergeable が false → conflict
 * （null は計算中なので待つ）/ 時間切れ → timeout。時間切れの回の読み取りが「最後の読み直し」なので、終わっていれば上の結果が先に出る。
 */
export function ciWaitStep(
  state: CiWaitState,
  read: CiWaitRead,
  now: number,
): { done: false; state: CiWaitState } | { done: true; result: CiWaitResult; conclusion: string | null; sha: string | null } {
  const end = (result: CiWaitResult, conclusion: string | null = null) => ({ done: true as const, result, conclusion, sha: state.sha });
  if (!read.ok) {
    const failures = state.failures + 1;
    if (failures >= CI_WAIT_MAX_FAILURES) return end("error");
    return now >= state.deadlineMs ? end("timeout") : { done: false, state: { ...state, failures } };
  }
  const next: CiWaitState = { ...state, failures: 0, sha: state.sha ?? read.sha ?? null };
  if (state.sha !== null && read.sha !== state.sha) return end("head-changed");
  if (read.appCheck?.status === "completed") {
    const conclusion = read.appCheck.conclusion;
    return { ...end(conclusion === "success" ? "success" : "failure", conclusion), sha: next.sha };
  }
  if (read.mergeable === false) return { ...end("conflict"), sha: next.sha };
  if (now >= state.deadlineMs) return { ...end("timeout"), sha: next.sha };
  return { done: false, state: next };
}
