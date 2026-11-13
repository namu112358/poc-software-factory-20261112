// 待っている Issue のどれから着手させるかの判定（`claim.ts pick`。割り当ての役の手順書の「1.」）。GitHub への書き込みはしない。

import {
  WIP_LIMIT,
  blockingDeps,
  hardDeps,
  isUrgentFix,
  latestQueued,
  latestTouch,
  makeCurrentFilesOf,
  makeIsActive,
  overlap,
  plannedFiles,
  queuedComment,
  waitOrder,
  waitsOn,
  type IssueInfo,
  type PrInfo,
} from "./queue.ts";

/** 開いている PR（自分の PR を除く）と作業中の Issue のうち、files と同じファイルを変えるもの */
function blocker(self: IssueInfo, files: string[], openPrs: PrInfo[], inProgress: IssueInfo[]): number | null {
  for (const pr of openPrs) {
    if (pr.headRef === `claude/issue-${self.number}`) continue;
    if (pr.stalled) continue; // 人を待って止まった PR は待たない（#255）
    if (overlap(files, pr.files).length > 0) return pr.number;
  }
  for (const i of inProgress) {
    if (i.number === self.number) continue;
    // 作業中の Issue に PR があれば、着手の記録（見積もり）ではなく PR の実際の変更ファイルで見る（#262）
    const pr = openPrs.find((p) => p.headRef === `claude/issue-${i.number}`);
    if (overlap(files, pr ? pr.files : (latestTouch(i)?.value ?? [])).length > 0) return i.number;
  }
  return null;
}

/**
 * 着手させる候補を選ぶ（scripts/factory/README.md の pick）。ラベルは変えず、取り出してよい Issue と、待ち先を付け替える Issue を返す。
 * 待ち始めが早い順に見る。キューの先頭（先に待っていて、それより前の先頭と重ならない Issue。取り出したものを含む）・開いている PR・作業中の Issue と同じファイルを変えるものは、
 * 取り出さずに待ち先を付け替える（取り出しても着手の前の確かめで戻るだけなので。#183）。待ち先が今と同じなら何もしない。
 */
export function pick(args: {
  queued: IssueInfo[];
  inProgressCount: number;
  isOpen: (n: number) => boolean;
  isStalled?: (n: number) => boolean;
  openPrs?: PrInfo[];
  inProgress?: IssueInfo[];
  readyRemaining?: number; // あと何回 status:in-progress を付けてよいか（readyBudget の remaining）。省けば数えない
  mainBroken?: boolean; // main の最新のコミットの app-check が失敗している（#363）
}): {
  slots: number;
  pick: number[];
  rewait: { issue: number; wait: number; files: string[]; comment: string }[];
} {
  const slots = Math.max(0, Math.min(WIP_LIMIT - args.inProgressCount, args.readyRemaining ?? Infinity));
  const picked: IssueInfo[] = [];
  const rewait: { issue: number; wait: number; files: string[]; comment: string }[] = [];
  const addRewait = (i: IssueInfo, wait: number, files: string[], reason: string) => {
    if (latestQueued(i)?.value.wait === wait) return; // すでに同じ待ち先なら、コメントをくり返さない
    rewait.push({ issue: i.number, wait, files, comment: queuedComment(wait, files, reason) });
  };
  const ctx = { openPrs: args.openPrs ?? [], inProgress: args.inProgress ?? [], queued: args.queued };
  const currentFilesOf = makeCurrentFilesOf(ctx);
  const isActive = makeIsActive(ctx);
  const heads: IssueInfo[] = []; // キューの先頭（予約を持つ）。取り出したものも先頭に入る
  // main の CI を壊している不具合の直しは、待ち始めの順より先に、同じファイルの待ちを越えて取り出す（#363）
  const urgent = (i: IssueInfo) => isUrgentFix(i, args.mainBroken);
  const order = [...args.queued].sort((a, b) => Number(urgent(b)) - Number(urgent(a)) || waitOrder(a, b));
  for (const i of order) {
    if (picked.length >= slots) break;
    const files = plannedFiles(i);
    if (urgent(i)) {
      if (hardDeps(i, args.isOpen).length > 0) continue;
      picked.push(i);
      continue;
    }
    // 先に待っている先頭と同じファイルを変えるなら、その先頭の後ろに並ぶ（自分を待っている先頭は除く）
    const ahead = heads.find((h) => overlap(files, plannedFiles(h)).length > 0 && !waitsOn(h, i.number, args.queued));
    if (ahead) {
      addRewait(i, ahead.number, files, `先に待っている #${ahead.number} が同じファイルを変える予定なので、取り出さずに #${ahead.number} を待つ。`);
      continue;
    }
    heads.push(i);
    if (blockingDeps(i, args.isOpen, args.isStalled, currentFilesOf, files, isActive).length > 0) continue;
    const busy = blocker(i, files, args.openPrs ?? [], args.inProgress ?? []);
    if (busy !== null) {
      addRewait(i, busy, files, `#${busy} が同じファイルを変えているので、取り出さずに #${busy} を待つ。`);
      continue;
    }
    const clash = picked.find((p) => overlap(files, plannedFiles(p)).length > 0);
    if (clash) {
      addRewait(i, clash.number, files, `同じ回に取り出した #${clash.number} と同じファイルを変えるので、#${clash.number} を待つ。`);
      continue;
    }
    picked.push(i);
  }
  return { slots, pick: picked.map((i) => i.number), rewait };
}
