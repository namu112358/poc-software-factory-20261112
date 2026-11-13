// CI のチェックの読み方（merge-check・stalled が使う）。

export type CheckState = "success" | "failure" | "pending" | "none";

/** Mergify のキューに入る条件のチェック（.mergify.yml の queue_conditions の check-success と合わせる） */
export const REQUIRED_CHECKS = ["app-check", "design-system-check", "pr-body-check"];

/** CI の結果として見るチェック（キューに入る条件のうち、PR 本文の検査を除いたもの）。巡回の「CI が通った・落ちた」の判定に使う */
export const CI_CHECKS = ["app-check", "design-system-check"];

/**
 * 複数のチェックの状態を 1 つにまとめる。1 つでも落ちていれば failure、それ以外で 1 つでも動いていれば pending、
 * 1 つでも無ければ none、すべて成功なら success。
 */
export function combineChecks(states: CheckState[]): CheckState {
  if (states.includes("failure")) return "failure";
  if (states.includes("pending")) return "pending";
  if (states.length === 0 || states.includes("none")) return "none";
  return "success";
}

/**
 * 最新のコミットで、キューに入る条件のチェックが成功しているか（#364）。
 * 同じ名前のチェックが何度も動いたときは、最後に始まったものを見る。
 */
export function ciCheck(runs: { name: string; status: string; conclusion: string | null; startedAt: string }[]): { ok: boolean; reason: string } {
  for (const name of REQUIRED_CHECKS) {
    const latest = runs
      .filter((r) => r.name === name)
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
      .at(-1);
    if (!latest) return { ok: false, reason: `最新のコミットに ${name} が無い。CI が動くのを待つ（動かないときは、PR 本文を編集すると動き直す）。` };
    if (latest.status !== "completed") return { ok: false, reason: `${name} がまだ終わっていない。終わってから確かめ直す。` };
    if (latest.conclusion !== "success") return { ok: false, reason: `${name} が ${latest.conclusion}。直して、CI が通ってから付ける。` };
  }
  return { ok: true, reason: "" };
}
