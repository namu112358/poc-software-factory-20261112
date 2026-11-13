// 起動しなかった実装の付け直しの判定（`claim.ts relabel`）。

import { START_MARK_RE } from "./labels.ts";
import type { Comment } from "./queue.ts";

/**
 * 起動しなかった実装の付け直しの対象（dispatch.md の「2.」・patrol.md の「1.」）。
 * status:in-progress（status:in-progress-hard）が付いてから minMinutes 以上たち、その後に実装の着手のコメントも PR も無く、
 * まだ付け直していない（relabel-start のコメントが無い）Issue。古い順に remaining 件まで。
 * 付け直し済みのものは needsHuman に入れる（2 回目は人に回す）。
 */
export function relabelTargets(args: {
  issues: { number: number; label: string; labeledAt: string; comments: Comment[]; hasPr: boolean }[];
  now: string;
  minMinutes: number;
  remaining: number;
}): { relabel: { issue: number; label: string }[]; needsHuman: number[] } {
  const cutoff = new Date(new Date(args.now).getTime() - args.minMinutes * 60 * 1000).toISOString();
  const relabel: { issue: number; label: string }[] = [];
  const needsHuman: number[] = [];
  for (const i of [...args.issues].sort((a, b) => (a.labeledAt < b.labeledAt ? -1 : 1))) {
    if (i.hasPr || i.labeledAt > cutoff) continue;
    if (i.comments.some((c) => c.createdAt >= i.labeledAt && START_MARK_RE.test(c.body))) continue;
    if (i.comments.some((c) => /factory:(dispatch|patrol) action=relabel-start/.test(c.body))) {
      needsHuman.push(i.number);
      continue;
    }
    if (relabel.length < args.remaining) relabel.push({ issue: i.number, label: i.label });
  }
  return { relabel, needsHuman };
}
