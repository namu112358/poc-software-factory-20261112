// 起動のきっかけの budget（`claim.ts budget`・pick・relabel が使う）。

/**
 * 実装の Routine の起動のきっかけ（`status:in-progress` / `status:in-progress-hard` が付いたこと）を、直近 60 分に何回まで使うか（#250）。
 * GitHub のイベントには Routine ごとの 1 時間あたりの上限があり、超えたイベントは捨てられる（数値は非公開）。
 * 2026-11-12 は、直近 60 分のきっかけが 53〜55 回になったところで実装の Routine が起動しなくなった。
 * 余裕をみて 45 回にする。上限が分かったら、この値だけを直す。
 * 上限が起動のきっかけ以外のイベント（ほかのラベルなど、フィルタを通る前のもの）も数えるなら、数える対象も見直す。
 * （名前の READY は、きっかけが ready（今の status:ready）だったときの名残り。値の意味は「起動のきっかけ」）
 */
export const READY_EVENTS_PER_HOUR_BUDGET = 45;

/** 直近 60 分のきっかけの数から、あと何回 status:in-progress を付けてよいか */
export function readyBudget(startsLastHour: number): { startsLastHour: number; budget: number; remaining: number } {
  return { startsLastHour, budget: READY_EVENTS_PER_HOUR_BUDGET, remaining: Math.max(0, READY_EVENTS_PER_HOUR_BUDGET - startsLastHour) };
}
