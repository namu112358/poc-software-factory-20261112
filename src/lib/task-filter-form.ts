import type { Db } from "./db/index.ts";
import { parseAssignees, parseTagFilters } from "./task-validation.ts";

export type CheckboxOption = { value: string; label: string; checked: boolean };

/** チェックボックスの並びを作る。選択済みの値にだけ checked を付ける（一覧に無い選択値は出さない）。 */
export function buildCheckboxOptions(options: { value: string; label: string }[], selected: string[]): CheckboxOption[] {
  return options.map((o) => ({ ...o, checked: selected.includes(o.value) }));
}

/** フォームの送信値（チェックを付けた項目が同じ名前で並ぶ）から、担当者とタグの絞り込み条件を作る。不正な値は無視する。 */
export function filterConditionsFromForm(form: URLSearchParams, db?: Db): { assignees: string[]; tags: string[] } {
  return { assignees: parseAssignees(form.getAll("assignee"), db), tags: parseTagFilters(form.getAll("tag"), db) };
}
