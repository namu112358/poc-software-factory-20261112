import { getDb, type Db } from "./db/index.ts";
import { parseAssignees, parseTagFilters } from "./task-validation.ts";
import { UNASSIGNED } from "./task-types.ts";
import { SUSPENDED_MARK } from "./members.ts";
import { listUserSummaries } from "./users.ts";

export type CheckboxOption = { value: string; label: string; checked: boolean };

/** チェックボックスの並びを作る。選択済みの値にだけ checked を付ける（一覧に無い選択値は出さない）。 */
export function buildCheckboxOptions(options: { value: string; label: string }[], selected: string[]): CheckboxOption[] {
  return options.map((o) => ({ ...o, checked: selected.includes(o.value) }));
}

/** フォームの送信値（チェックを付けた項目が同じ名前で並ぶ）から、担当者とタグの絞り込み条件を作る。不正な値は無視する。 */
export function filterConditionsFromForm(form: URLSearchParams, db?: Db): { assignees: string[]; tags: string[] } {
  return { assignees: parseAssignees(form.getAll("assignee"), db), tags: parseTagFilters(form.getAll("tag"), db) };
}

/**
 * タスク一覧の担当者の絞り込みの選択肢。アプリの利用者を全員（今担当のタスクが無い人も）並べ、最後に「担当者なし」を置く。
 * 選んだ値にだけ checked を付ける（#436）。ログインを停止した人も残し（引き継ぐタスクを探せるように）、名前に「（停止中）」を付ける（#522）。
 */
export function buildAssigneeFilterOptions(selected: string[], db: Db = getDb()): CheckboxOption[] {
  const users = listUserSummaries(db).map((u) => ({ value: u.id, label: u.suspended ? `${u.name}${SUSPENDED_MARK}` : u.name }));
  return buildCheckboxOptions([...users, { value: UNASSIGNED, label: "担当者なし" }], selected);
}
