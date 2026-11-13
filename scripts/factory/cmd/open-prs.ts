// 開いている claude/ の PR の読み取り（pick・precheck・relabel が使う）。

import { STALLED_LABELS } from "../core/labels.ts";
import type { PrInfo } from "../core/queue.ts";
import { isOwnClaudePr, type HeadRef } from "../core/repo.ts";
import { REPO, getAll, issueOf } from "./github.ts";
import { isStalled, loadOpen } from "./open-state.ts";

export async function loadOpenPrs(): Promise<PrInfo[]> {
  const prs = await getAll<{ number: number; head: HeadRef; labels?: { name: string }[] }>(`/repos/${REPO}/pulls?state=open`);
  const mine = prs.filter((p) => isOwnClaudePr(p, REPO));
  await loadOpen(mine.map((p) => issueOf(p.head.ref)).filter((n) => Number.isInteger(n)));
  return Promise.all(
    mine.map(async (p) => ({
      number: p.number,
      headRef: p.head.ref,
      files: (await getAll<{ filename: string }>(`/repos/${REPO}/pulls/${p.number}/files`)).map((f) => f.filename),
      stalled: (p.labels ?? []).some((l) => STALLED_LABELS.includes(l.name)) || isStalled(issueOf(p.head.ref)),
    })),
  );
}

export async function ownPr(n: number): Promise<number | null> {
  const owner = REPO.split("/")[0];
  const prs = await getAll<{ number: number }>(`/repos/${REPO}/pulls?state=open&head=${owner}:claude/issue-${n}`);
  return prs[0]?.number ?? null;
}
