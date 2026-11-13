// 待っている Issue（キュー）の読み方: 依存先・待ち始めの順・変えるファイルの重なり。pick と precheck が共通で使う（#137・#218・#220）。
// 決まりの説明は scripts/factory/README.md。

import { LABEL, STALLED_LABELS } from "./labels.ts";

export const WIP_LIMIT = 4;

export type Comment = { body: string; createdAt: string; author?: string };

export type IssueInfo = {
  number: number;
  body: string;
  comments: Comment[];
  blockedBy?: number[]; // GitHub の依存関係（blocked by）に登録された Issue の番号
  labels?: string[]; // いまのラベル（今の名前に直した値。precheck で、付ける直前に読み直した値。#322）
};

/** stalled: PR か、その Issue（claude/issue-<番号>）に status:needs-human・status:blocked-question が付いて、人を待っている（#255） */
export type PrInfo = { number: number; headRef: string; files: string[]; stalled?: boolean };

export type Wait = number | "slot";

const TOUCH_RE = /<!--\s*factory:touch\s+files=(\S*)(?:\s+ahead=\S*)?\s*-->/;
const QUEUED_RE = /<!--\s*factory:queued([^>]*?)-->/;

export function splitFiles(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseTouch(body: string): string[] | null {
  const m = TOUCH_RE.exec(body);
  return m ? splitFiles(m[1]) : null;
}

export function parseQueued(body: string): { wait: Wait | null; files: string[] } | null {
  const m = QUEUED_RE.exec(body);
  if (!m) return null;
  const attrs = m[1];
  const w = /wait=(#\d+|slot)/.exec(attrs);
  const f = /files=(\S*)/.exec(attrs);
  let wait: Wait | null = null;
  if (w) wait = w[1] === "slot" ? "slot" : Number(w[1].slice(1));
  return { wait, files: splitFiles(f?.[1]) };
}

function latest<T>(comments: Comment[], parse: (body: string) => T | null): { value: T; createdAt: string } | null {
  let found: { value: T; createdAt: string } | null = null;
  for (const c of comments) {
    const v = parse(c.body);
    if (v !== null && (found === null || c.createdAt >= found.createdAt)) found = { value: v, createdAt: c.createdAt };
  }
  return found;
}

export function latestTouch(issue: IssueInfo) {
  return latest(issue.comments, parseTouch);
}

export function latestQueued(issue: IssueInfo) {
  return latest(issue.comments, parseQueued);
}

/** 待ち始めた時刻: 最初の factory:queued のコメントの時刻。キューに載ったことが無ければ null（#183） */
export function waitingSince(issue: IssueInfo): string | null {
  let first: string | null = null;
  for (const c of issue.comments) {
    if (parseQueued(c.body) !== null && (first === null || c.createdAt < first)) first = c.createdAt;
  }
  return first;
}

/** 待っている順: 待ち始めが早いほうが先。キューに載ったことが無いものは最後。同じなら番号が小さいほうが先 */
export function waitOrder(a: IssueInfo, b: IssueInfo): number {
  const wa = waitingSince(a);
  const wb = waitingSince(b);
  if (wa !== wb) {
    if (wa === null) return 1;
    if (wb === null) return -1;
    return wa < wb ? -1 : 1;
  }
  return a.number - b.number;
}

/**
 * from の依存先をたどると target に着くか（queued の Issue の中だけをたどる）。
 * 自分を待っている Issue を「先に待っている」として待つと、お互いを待って止まるので、それを見分ける（#253 のレビュー）。
 */
export function waitsOn(from: IssueInfo, target: number, queued: IssueInfo[]): boolean {
  const byNumber = new Map(queued.map((i) => [i.number, i]));
  const seen = new Set<number>();
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur.number)) continue;
    seen.add(cur.number);
    for (const d of dependencies(cur)) {
      if (d === target) return true;
      const next = byNumber.get(d);
      if (next) stack.push(next);
    }
  }
  return false;
}

/** 本文の「#N の後」に書かれた番号 */
export function bodyDeps(body: string): number[] {
  const out: number[] = [];
  for (const m of body.matchAll(/#(\d+)\s*の後/g)) out.push(Number(m[1]));
  return out;
}

/** 依存先（scripts/factory/README.md の定義）: blocked by・本文の「#N の後」・最新の factory:queued の wait=#N */
export function dependencies(issue: IssueInfo): number[] {
  const deps = new Set<number>([...(issue.blockedBy ?? []), ...bodyDeps(issue.body)]);
  const q = latestQueued(issue);
  if (q && typeof q.value.wait === "number") deps.add(q.value.wait);
  deps.delete(issue.number);
  return [...deps].sort((a, b) => a - b);
}

/**
 * 番号（Issue か PR）が人を待って止まっているか、を返す関数を作る（#255）。
 * labels: 番号ごとのラベル。prIssue: PR の番号 → その PR の Issue（claude/issue-<番号>）の番号。
 * PR は、PR 自身か、その Issue のどちらかに印があれば止まっているとみなす（止まるときに印を付けるのは Issue のことが多いため）。
 */
export function makeIsStalled(labels: Map<number, string[]>, prIssue: Map<number, number>): (n: number) => boolean {
  const marked = (n: number) => (labels.get(n) ?? []).some((l) => STALLED_LABELS.includes(l));
  return (n: number) => {
    if (marked(n)) return true;
    const issue = prIssue.get(n);
    return issue !== undefined && marked(issue);
  };
}

/**
 * まだ待つ依存先。blocked by・「#N の後」（人が決めた依存）は、開いていれば待つ。
 * factory:queued の wait=#N（同じファイルを変える作業を待つもの）は、開いていても、
 * 待ち先が status:needs-human・status:blocked-question で人を待っているなら待たない（無期限に止まらないため。#255）。
 */
/** 人が決めた依存（blocked by・本文の「#N の後」）のうち、まだ開いているもの。同じファイル待ち（wait=#N）は含めない */
export function hardDeps(issue: IssueInfo, isOpen: (n: number) => boolean): number[] {
  const out = new Set<number>([...(issue.blockedBy ?? []), ...bodyDeps(issue.body)].filter((n) => isOpen(n)));
  out.delete(issue.number);
  return [...out].sort((a, b) => a - b);
}

export function blockingDeps(
  issue: IssueInfo,
  isOpen: (n: number) => boolean,
  isStalled: (n: number) => boolean = () => false,
  currentFilesOf: (n: number) => string[] | null = () => null,
  files: string[] = plannedFiles(issue),
  isActive: (n: number) => boolean = () => true,
): number[] {
  const hard = new Set<number>([...(issue.blockedBy ?? []), ...bodyDeps(issue.body)]);
  const out = new Set<number>([...hard].filter((n) => isOpen(n)));
  const q = latestQueued(issue);
  // 待ち先がキューにいるだけ（動いていない）なら、依存にはしない。キューの中の順番は予約で決める（数珠つなぎにしないため。#275）
  if (q && typeof q.value.wait === "number" && !hard.has(q.value.wait) && isOpen(q.value.wait) && !isStalled(q.value.wait) && isActive(q.value.wait)) {
    // 待ち先の今のファイルが分かり、自分の変えるファイルと重ならなければ、待つ理由が無くなったので待たない（#262）
    const now = currentFilesOf(q.value.wait);
    if (now === null || files.length === 0 || overlap(files, now).length > 0) out.add(q.value.wait);
  }
  out.delete(issue.number);
  return [...out].sort((a, b) => a - b);
}

/**
 * 待ち先（Issue か PR）の今の変えるファイル。分からなければ null（そのときは待ち続ける）。
 * PR は変更ファイル。Issue は、PR があればその変更ファイル、無ければ作業中なら最新の factory:touch、queued なら記録の files=。
 */
export function makeCurrentFilesOf(ctx: { openPrs: PrInfo[]; inProgress: IssueInfo[]; queued: IssueInfo[] }): (n: number) => string[] | null {
  return (n: number) => {
    const pr = ctx.openPrs.find((p) => p.number === n);
    if (pr) return pr.files;
    const working = ctx.inProgress.find((i) => i.number === n);
    const waiting = ctx.queued.find((i) => i.number === n);
    const ownPr = ctx.openPrs.find((p) => p.headRef === `claude/issue-${n}`);
    if (!working && !waiting && !ownPr) return null;
    // PR があれば、実際の変更ファイルを使う（factory:touch・files= は着手の前の見積もりで、分けたファイルの古い名前が残ることがある）
    if (ownPr) return ownPr.files;
    // 記録が無い・空なら、重ならないのではなく「分からない」として待ち続ける（着手してから記録するまでの数秒など）
    const recorded = working ? (latestTouch(working)?.value ?? []) : waiting ? plannedFiles(waiting) : [];
    return recorded.length > 0 ? recorded : null;
  };
}

/**
 * 番号（Issue か PR）が動いている作業か: 開いている PR、作業中の Issue、PR を持つ Issue。
 * キューにいるだけの Issue は動いていない。どちらとも分からない番号は、動いているとみなす（待つほうに倒す）。
 */
export function makeIsActive(ctx: { openPrs: PrInfo[]; inProgress: IssueInfo[]; queued: IssueInfo[] }): (n: number) => boolean {
  return (n: number) => {
    if (ctx.openPrs.some((p) => p.number === n || p.headRef === `claude/issue-${n}`)) return true;
    if (ctx.inProgress.some((i) => i.number === n)) return true;
    return !ctx.queued.some((i) => i.number === n);
  };
}

/**
 * キューの先頭（予約を持つ Issue）: 待ち始めの早い順に見て、それより前の先頭と変えるファイルが重ならないもの。
 * 先頭に重なって並んでいる Issue は、ほかの Issue を並ばせない（予約の数珠つなぎを 1 段にする。#275）。
 * 自分を待っている Issue（waitsOn）は、自分にとっての先頭にしない。
 */
export function queueHeads(queued: IssueInfo[], self?: number): IssueInfo[] {
  const heads: IssueInfo[] = [];
  for (const i of [...queued].sort(waitOrder)) {
    if (i.number === self) continue;
    if (self !== undefined && waitsOn(i, self, queued)) continue;
    const files = plannedFiles(i);
    if (heads.some((h) => overlap(files, plannedFiles(h)).length > 0)) continue;
    heads.push(i);
  }
  return heads;
}

/** 変えるファイル: 最新の factory:queued の files=、無ければ最新の factory:touch の files= */
export function plannedFiles(issue: IssueInfo): string[] {
  const q = latestQueued(issue);
  if (q && q.value.files.length > 0) return q.value.files;
  return latestTouch(issue)?.value ?? [];
}

export function overlap(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((f) => set.has(f));
}

export function queuedComment(wait: Wait, files: string[], reason: string): string {
  const w = wait === "slot" ? "slot" : `#${wait}`;
  const f = files.length > 0 ? ` files=${files.join(",")}` : "";
  return `<!-- factory:queued wait=${w}${f} -->\n${reason}`;
}

/**
 * `main` の CI が壊れているときの不具合の直し（#363）。同じファイルの待ちより先に着手させる。
 * 依存先・同時に実装する数の上限は、ほかの Issue と同じく守る。
 */
export function isUrgentFix(i: IssueInfo, mainBroken: boolean | undefined): boolean {
  return mainBroken === true && (i.labels ?? []).includes(LABEL.fix);
}
