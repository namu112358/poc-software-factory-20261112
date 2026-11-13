// `claim.ts budget`: 直近 60 分に status:in-progress を付けた回数と、あと何回付けてよいか。pick・relabel も読む。

import { START_LABELS, normalizeLabel } from "../core/labels.ts";
import { readyBudget } from "../core/budget.ts";
import { REPO, get } from "./github.ts";

/** 直近 60 分に status:in-progress / status:in-progress-hard が付いた回数（実装の Routine の起動のきっかけ。#250） */
export async function loadBudget() {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let count = 0;
  for (let page = 1; page <= 10; page++) {
    const { data } = await get<{ event: string; created_at: string; label?: { name: string } }[]>(`/repos/${REPO}/issues/events?per_page=100&page=${page}`);
    for (const e of data) {
      if (e.created_at > since && e.event === "labeled" && START_LABELS.includes(normalizeLabel(e.label?.name ?? ""))) count++;
    }
    if (data.length < 100 || data.some((e) => e.created_at <= since)) break;
  }
  return readyBudget(count);
}
