// `claim.ts relabel --minutes 15`: 起動しなかった実装の付け直しの対象（付け直す数は budget の残りまで）。

import { LABEL, START_LABELS, normalizeLabel } from "../core/labels.ts";
import { relabelTargets } from "../core/relabel.ts";
import { loadBudget } from "./budget.ts";
import { REPO, arg, getAll } from "./github.ts";
import { loadInProgress } from "./issues.ts";
import { ownPr } from "./open-prs.ts";

export async function runRelabel() {
  const minutes = Number(arg("minutes") ?? "15");
  const [inProgress, b] = await Promise.all([loadInProgress(), loadBudget()]);
  const issues = await Promise.all(
    inProgress.map(async (i) => {
      const events = await getAll<{ event: string; created_at: string; label?: { name: string } }>(`/repos/${REPO}/issues/${i.number}/events`);
      const last = events.filter((e) => e.event === "labeled" && START_LABELS.includes(normalizeLabel(e.label?.name ?? ""))).pop();
      return { number: i.number, label: normalizeLabel(last?.label?.name ?? LABEL.inProgress), labeledAt: last?.created_at ?? "", comments: i.comments, hasPr: (await ownPr(i.number)) !== null };
    }),
  );
  const r = relabelTargets({ issues: issues.filter((i) => i.labeledAt), now: new Date().toISOString(), minMinutes: minutes, remaining: b.remaining });
  return { ...b, minutes, ...r };
}
