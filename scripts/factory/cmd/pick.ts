// `claim.ts pick`: 待っている Issue（status:ready あり・status:in-progress なし）のうち、着手させる候補。

import { dependencies } from "../core/queue.ts";
import { pick } from "../core/pick.ts";
import { loadBudget } from "./budget.ts";
import { loadInProgress, loadWaiting } from "./issues.ts";
import { loadMainBroken } from "./main-broken.ts";
import { isOpen, isStalled, loadOpen } from "./open-state.ts";
import { loadOpenPrs } from "./open-prs.ts";

export async function runPick() {
  const [queued, inProgress, openPrs, b] = await Promise.all([loadWaiting(), loadInProgress(), loadOpenPrs(), loadBudget()]);
  await loadOpen(queued.flatMap(dependencies));
  const inProgressCount = inProgress.length;
  return { inProgress: inProgressCount, ...b, ...pick({ queued, inProgressCount, isOpen, isStalled, openPrs, inProgress, readyRemaining: b.remaining, mainBroken: await loadMainBroken() }) };
}
