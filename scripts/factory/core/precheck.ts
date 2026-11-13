// 着手してよいかの判定（`claim.ts precheck`。割り当ての役の手順書の「1.」）。GitHub への書き込みはしない。

import { LABEL, NOT_STARTABLE_LABELS } from "./labels.ts";
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
  queueHeads,
  queuedComment,
  waitOrder,
  type IssueInfo,
  type PrInfo,
  type Wait,
} from "./queue.ts";

export type Decision =
  | { decision: "go"; note?: string; ahead?: number[] }
  | { decision: "skip"; reason: string }
  | { decision: "queue" | "retreat"; wait: Wait; files: string[]; reason: string; comment: string };

function queue(kind: "queue" | "retreat", wait: Wait, files: string[], reason: string): Decision {
  return { decision: kind, wait, files, reason, comment: queuedComment(wait, files, reason) };
}

/**
 * 着手の前の確かめ（implement.md の「キューに載せる」）。
 * inProgress: status:in-progress の付いた開いている Issue（自分を含んでいてよい）
 * queued: queued の付いた開いている Issue
 * openPrs: 開いている claude/ の PR
 */
export function precheck(args: {
  self: IssueInfo;
  ownPr?: number | null; // claude/issue-<自分の番号> の開いている PR

  files: string[];
  inProgress: IssueInfo[];
  queued: IssueInfo[];
  openPrs: PrInfo[];
  isOpen: (n: number) => boolean;
  isStalled?: (n: number) => boolean;
  mainBroken?: boolean; // main の最新のコミットの app-check が失敗している（#363）
}): Decision {
  const { self, files } = args;
  // 着手の合図を付ける直前に、ラベルを読み直した値で確かめる（#322: ready を外した 20 秒後に in-progress が付いた）
  if (self.labels !== undefined) {
    const blocking = self.labels.filter((l) => NOT_STARTABLE_LABELS.includes(l));
    if (!self.labels.includes(LABEL.ready) || blocking.length > 0) {
      const why = !self.labels.includes(LABEL.ready) ? `\`${LABEL.ready}\`（人の承認）が無い` : `${blocking.map((l) => `\`${l}\``).join("・")} が付いている`;
      return { decision: "skip", reason: `${why}ので、着手させずに次へ進む。` };
    }
  }
  if (args.ownPr) return ownPrGo(args.ownPr);
  // main の CI を壊している不具合の直しは、人が決めた依存だけを待つ（同じファイル待ちの wait=#N は待たない。#363）
  const urgent = isUrgentFix(self, args.mainBroken);
  const openDeps = urgent ? hardDeps(self, args.isOpen) : blockingDeps(self, args.isOpen, args.isStalled, makeCurrentFilesOf(args), files, makeIsActive(args));
  if (openDeps.length > 0) {
    return queue("queue", openDeps[0], files, `依存先 #${openDeps.join("・#")} がまだ開いているので待つ。`);
  }
  const others = args.inProgress.filter((i) => i.number !== self.number);
  if (others.length >= WIP_LIMIT) {
    return queue("queue", "slot", files, `空き待ち。作業中が ${others.length} 件（#${others.map((i) => i.number).join("・#")}）で、上限の ${WIP_LIMIT} 件に達している。`);
  }
  if (urgent) {
    return {
      decision: "go",
      ahead: aheadOf(args.queued, self, files),
      note: `\`main\` の CI が壊れていて、この Issue は不具合の直し（\`${LABEL.fix}\`）なので、同じファイルの待ちより先に着手する（#363）。同じファイルを変える PR とは、後からマージされるほうで衝突を解消する。このことを着手のコメントに書く。`,
    };
  }
  const stalledOverlaps: string[] = [];
  for (const pr of args.openPrs) {
    if (pr.headRef === `claude/issue-${self.number}`) continue;
    const o = overlap(files, pr.files);
    if (o.length === 0) continue;
    if (pr.stalled) {
      stalledOverlaps.push(`PR #${pr.number}（${o.join("、")}）`);
      continue;
    }
    return queue("queue", pr.number, files, `PR #${pr.number} が同じファイル（${o.join("、")}）を変えているので、閉じるまで待つ。`);
  }
  for (const i of others) {
    const o = overlap(files, latestTouch(i)?.value ?? []);
    if (o.length > 0) return queue("queue", i.number, files, `作業中の #${i.number} が同じファイル（${o.join("、")}）を変える予定なので、閉じるまで待つ。`);
  }
  // 自分より先に待ち始めた queued の Issue（自分がキューに載ったことが無ければ、queued のすべて）を追い越さない（#183）
  // ただし、待ち先をたどると自分に着く Issue（自分を待っている Issue）は除く（お互いを待って止まらないため）
  // 比べるのはキューの先頭（予約を持つ Issue）だけ（#275）
  const olderQueued = queueHeads(args.queued, self.number).filter((i) => waitOrder(i, self) < 0);
  for (const i of olderQueued) {
    const o = overlap(files, plannedFiles(i));
    if (o.length > 0) return queue("queue", i.number, files, `先に待っている #${i.number} が同じファイル（${o.join("、")}）を変える予定なので、追い越さずに待つ。`);
  }
  // 追い越しを記録から数えられるように、先に待ち始めていて同じファイルを予定している Issue を残す（#183）
  const ahead = aheadOf(args.queued, self, files);
  if (stalledOverlaps.length > 0) {
    return {
      decision: "go",
      ahead,
      note: `${stalledOverlaps.join("・")} は同じファイルを変えるが、status:needs-human・status:blocked-question で人を待っているので待たずに着手する（#255）。後からマージされるほうで衝突したら、割り当て・修正の役が解消する。このことを着手のコメントに書く。`,
    };
  }
  return { decision: "go", ahead };
}

/** 先に待ち始めていて、同じファイルを予定している Issue（追い越しを記録から数えるため。#183） */
function aheadOf(queued: IssueInfo[], self: IssueInfo, files: string[]): number[] {
  return queued
    .filter((i) => i.number !== self.number && waitOrder(i, self) < 0 && overlap(files, plannedFiles(i)).length > 0)
    .map((i) => i.number)
    .sort((a, b) => a - b);
}

/** 自分の PR がすでにあれば、引き下がらせずに進めさせる（残った PR が Issue の再開を止めるため。#248） */
function ownPrGo(pr: number): Decision {
  return { decision: "go", note: `この Issue の PR #${pr} がすでに開いている。引き下がらずに、その PR を引き継いで進める（CI を見て Ready にする）。` };
}

/** 役がそのまま行う操作: 外すラベル・付けるラベル・書くコメント（null なら書かない） */
export type Actions = { removeLabels: string[]; addLabels: string[]; addLabelsIfHard?: string[]; comment: string | null };

/**
 * precheck の結果から、割り当て・巡回の役がそのまま行う操作を作る。
 * go: status:ready を外して status:in-progress（難しいと判定したら status:in-progress-hard）を付け、着手の記録（factory:touch）を書く。
 * queue: ラベルは変えず、待ちの記録を書く（直前の待ちと待ち先が同じなら書かない）。
 */
export function precheckActions(self: IssueInfo, files: string[], d: Decision): Actions {
  if (d.decision === "skip") return { removeLabels: [], addLabels: [], comment: null };
  if (d.decision === "go") {
    const note = d.note ? `\n${d.note}` : "";
    const ahead = d.ahead ?? [];
    const order =
      ahead.length === 0
        ? "同じファイルを予定して先に待っている Issue は無い（この Issue が先頭）。"
        : `同じファイルを予定して先に待っている #${ahead.join("・#")} より先に着手する（それらは依存・人待ち・ほかの待ちの後ろにいて、まだ着手できない）。`;
    return {
      removeLabels: [LABEL.ready],
      addLabels: [LABEL.inProgress],
      addLabelsIfHard: [LABEL.inProgressHard],
      comment: `<!-- factory:touch files=${files.join(",")} ahead=${ahead.map((n) => `#${n}`).join(",")} -->\n着手させた（変えるファイルは上のとおり）。${order}難しいと判定したときは、当たった観点をこの下に書く。${note}`,
    };
  }
  const same = latestQueued(self)?.value.wait === d.wait;
  return { removeLabels: [], addLabels: [], comment: same ? null : d.comment };
}

/** precheck が error のときの操作: status:ready を外して status:needs-human を付け、理由を書く */
export function errorActions(reason: string): Actions {
  return { removeLabels: [LABEL.ready], addLabels: [LABEL.needsHuman], comment: `着手させる前の確かめが失敗したので止めた。\n${reason}` };
}
