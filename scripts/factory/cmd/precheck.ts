// `claim.ts precheck <Issue> --files a.ts,b.ts`: 候補 1 件を着手させてよいかの確かめ（actions に、そのまま行う操作）。

import { dependencies, splitFiles } from "../core/queue.ts";
import { precheck, precheckActions } from "../core/precheck.ts";
import { arg } from "./github.ts";
import { loadIssue, loadInProgress, loadWaiting } from "./issues.ts";
import { loadMainBroken } from "./main-broken.ts";
import { isOpen, isStalled, loadOpen } from "./open-state.ts";
import { loadOpenPrs, ownPr } from "./open-prs.ts";

export async function runPrecheck(n: number) {
  if (!Number.isInteger(n)) throw new Error("Issue の番号を指定する");
  const files = splitFiles(arg("files")).filter((f) => !f.startsWith("tests/"));
  const [self, inProgress, queued, openPrs, own] = await Promise.all([loadIssue(n), loadInProgress(), loadWaiting(), loadOpenPrs(), ownPr(n)]);
  await loadOpen(dependencies(self));
  const d = precheck({ self, files, inProgress, queued, openPrs, isOpen, isStalled, ownPr: own, mainBroken: await loadMainBroken() });
  return { issue: n, files, ...d, actions: precheckActions(self, files, d) };
}
