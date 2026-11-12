// Factory の Routine が使う「着手してよいか・キューから取り出してよいか」の判定（#137・#218・#220）。
// GitHub への書き込み（ラベルの付け外し・コメント）はしない。判定だけを返し、役がその結果に従う。
// 決まりの本文は .claude/routines/README.md の「キュー」と implement.md の「1.」「2.」。

export const WIP_LIMIT = 4;

/**
 * 実装の Routine の起動のきっかけ（`ready` / `ready:hard` が付いたこと）を、直近 60 分に何回まで使うか（#250）。
 * GitHub のイベントには Routine ごとの 1 時間あたりの上限があり、超えたイベントは捨てられる（数値は非公開）。
 * 2026-11-12 は、直近 60 分のきっかけが 53〜55 回になったところで実装の Routine が起動しなくなった。
 * 余裕をみて 45 回にする。上限が分かったら、この値だけを直す。
 * 上限が ready 以外のイベント（ほかのラベルなど、フィルタを通る前のもの）も数えるなら、数える対象も見直す。
 */
export const READY_EVENTS_PER_HOUR_BUDGET = 45;

/** 直近 60 分のきっかけの数から、あと何回 ready を付けてよいか */
export function readyBudget(readyLastHour: number): { readyLastHour: number; budget: number; remaining: number } {
  return { readyLastHour, budget: READY_EVENTS_PER_HOUR_BUDGET, remaining: Math.max(0, READY_EVENTS_PER_HOUR_BUDGET - readyLastHour) };
}

export type Comment = { body: string; createdAt: string; author?: string };

export type IssueInfo = {
  number: number;
  body: string;
  comments: Comment[];
  blockedBy?: number[]; // GitHub の依存関係（blocked by）に登録された Issue の番号
};

/** stalled: PR か、その Issue（claude/issue-<番号>）に needs-human・blocked:question が付いて、人を待っている（#255） */
export type PrInfo = { number: number; headRef: string; files: string[]; stalled?: boolean };

export type Wait = number | "slot";

export type Decision =
  | { decision: "go"; note?: string }
  | { decision: "queue" | "retreat"; wait: Wait; files: string[]; reason: string; comment: string };

const TOUCH_RE = /<!--\s*factory:touch\s+files=(\S*)\s*-->/;
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

/** 依存先（README の「キュー」の定義）: blocked by・本文の「#N の後」・最新の factory:queued の wait=#N */
export function dependencies(issue: IssueInfo): number[] {
  const deps = new Set<number>([...(issue.blockedBy ?? []), ...bodyDeps(issue.body)]);
  const q = latestQueued(issue);
  if (q && typeof q.value.wait === "number") deps.add(q.value.wait);
  deps.delete(issue.number);
  return [...deps].sort((a, b) => a - b);
}

export const STALLED_LABELS = ["needs-human", "blocked:question"];

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
 * 待ち先が needs-human・blocked:question で人を待っているなら待たない（無期限に止まらないため。#255）。
 */
export function blockingDeps(
  issue: IssueInfo,
  isOpen: (n: number) => boolean,
  isStalled: (n: number) => boolean = () => false,
  currentFilesOf: (n: number) => string[] | null = () => null,
  files: string[] = plannedFiles(issue),
): number[] {
  const hard = new Set<number>([...(issue.blockedBy ?? []), ...bodyDeps(issue.body)]);
  const out = new Set<number>([...hard].filter((n) => isOpen(n)));
  const q = latestQueued(issue);
  if (q && typeof q.value.wait === "number" && !hard.has(q.value.wait) && isOpen(q.value.wait) && !isStalled(q.value.wait)) {
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
    if (working) return latestTouch(working)?.value ?? [];
    return waiting ? plannedFiles(waiting) : null;
  };
}

/** 変えるファイル: 最新の factory:queued の files=、無ければ最新の factory:touch の files= */
export function plannedFiles(issue: IssueInfo): string[] {
  const q = latestQueued(issue);
  if (q && q.value.files.length > 0) return q.value.files;
  return latestTouch(issue)?.value ?? [];
}

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((f) => set.has(f));
}

function queuedComment(wait: Wait, files: string[], reason: string): string {
  const w = wait === "slot" ? "slot" : `#${wait}`;
  const f = files.length > 0 ? ` files=${files.join(",")}` : "";
  return `<!-- factory:queued wait=${w}${f} -->\n${reason}`;
}

function queue(kind: "queue" | "retreat", wait: Wait, files: string[], reason: string): Decision {
  return { decision: kind, wait, files, reason, comment: queuedComment(wait, files, reason) };
}

/**
 * 着手の前の確かめ（implement.md の「キューに載せる」）。
 * inProgress: in-progress の付いた開いている Issue（自分を含んでいてよい）
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
}): Decision {
  const { self, files } = args;
  if (args.ownPr) return ownPrGo(args.ownPr);
  const openDeps = blockingDeps(self, args.isOpen, args.isStalled, makeCurrentFilesOf(args), files);
  if (openDeps.length > 0) {
    return queue("queue", openDeps[0], files, `依存先 #${openDeps.join("・#")} がまだ開いているので待つ。`);
  }
  const others = args.inProgress.filter((i) => i.number !== self.number);
  if (others.length >= WIP_LIMIT) {
    return queue("queue", "slot", files, `空き待ち。作業中が ${others.length} 件（#${others.map((i) => i.number).join("・#")}）で、上限の ${WIP_LIMIT} 件に達している。`);
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
  const olderQueued = args.queued
    .filter((i) => i.number !== self.number && waitOrder(i, self) < 0 && !waitsOn(i, self.number, args.queued))
    .sort(waitOrder);
  for (const i of olderQueued) {
    const o = overlap(files, plannedFiles(i));
    if (o.length > 0) return queue("queue", i.number, files, `先に待っている #${i.number} が同じファイル（${o.join("、")}）を変える予定なので、追い越さずに待つ。`);
  }
  if (stalledOverlaps.length > 0) {
    return {
      decision: "go",
      note: `${stalledOverlaps.join("・")} は同じファイルを変えるが、needs-human・blocked:question で人を待っているので待たずに着手する（#255）。後からマージされるほうで衝突したら、割り当て・修正の役が解消する。このことを着手のコメントに書く。`,
    };
  }
  return { decision: "go" };
}

/** 自分の PR がすでにあれば、引き下がらせずに進めさせる（残った PR が Issue の再開を止めるため。#248） */
function ownPrGo(pr: number): Decision {
  return { decision: "go", note: `この Issue の PR #${pr} がすでに開いている。引き下がらずに、その PR を引き継いで進める（CI を見て Ready にする）。` };
}

/** 記録の前後: 時刻が早いほうが先。同じ時刻なら番号が小さいほうが先 */
function isBefore(a: { number: number; at: string }, b: { number: number; at: string }): boolean {
  return a.at < b.at || (a.at === b.at && a.number < b.number);
}

/**
 * 着手して 30 秒後の読み直し（implement.md の「2. 着手する」の 2）。
 * 時刻は、それぞれの Issue の最新の factory:touch を使う。
 */
export function confirm(args: { self: IssueInfo; inProgress: IssueInfo[]; ownPr?: number | null }): Decision | { decision: "error"; reason: string } {
  if (args.ownPr) return ownPrGo(args.ownPr);
  const mine = latestTouch(args.self);
  if (!mine) return { decision: "error", reason: `#${args.self.number} に factory:touch の記録が無い。先に記録してから実行する。` };
  const me = { number: args.self.number, at: mine.createdAt };
  const others = args.inProgress.filter((i) => i.number !== args.self.number);
  const earlier: number[] = [];
  let firstOverlap: { number: number; files: string[] } | null = null;
  for (const i of [...others].sort((a, b) => a.number - b.number)) {
    const t = latestTouch(i);
    if (!t) {
      earlier.push(i.number); // 記録の無い作業中の Issue は、先に着手したものとして数える
      continue;
    }
    if (!isBefore({ number: i.number, at: t.createdAt }, me)) continue;
    earlier.push(i.number);
    const o = overlap(mine.value, t.value);
    if (o.length > 0 && firstOverlap === null) firstOverlap = { number: i.number, files: o };
  }
  if (firstOverlap) {
    return queue("retreat", firstOverlap.number, mine.value, `先に着手した #${firstOverlap.number} と同じファイル（${firstOverlap.files.join("、")}）を変えるので、引き下がって待つ。`);
  }
  if (earlier.length >= WIP_LIMIT) {
    return queue("retreat", "slot", mine.value, `空き待ち。自分より先に着手した作業中の Issue が ${earlier.length} 件（#${earlier.join("・#")}）あり、上限の ${WIP_LIMIT} 件に達しているので引き下がる。`);
  }
  return { decision: "go" };
}

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
 * キューから取り出す（README の「キュー」）。ラベルは変えず、取り出してよい Issue と、待ち先を付け替える Issue を返す。
 * 待ち始めが早い順に見る。先に待っている（依存先が開いていて飛ばした）Issue・開いている PR・作業中の Issue・同じ回に取り出した Issue と同じファイルを変えるものは、
 * 取り出さずに待ち先を付け替える（取り出しても着手の前の確かめで戻るだけなので。#183）。待ち先が今と同じなら何もしない。
 */
export function pick(args: {
  queued: IssueInfo[];
  inProgressCount: number;
  isOpen: (n: number) => boolean;
  isStalled?: (n: number) => boolean;
  openPrs?: PrInfo[];
  inProgress?: IssueInfo[];
  readyRemaining?: number; // あと何回 ready を付けてよいか（readyBudget の remaining）。省けば数えない
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
  const currentFilesOf = makeCurrentFilesOf({ openPrs: args.openPrs ?? [], inProgress: args.inProgress ?? [], queued: args.queued });
  const skipped: IssueInfo[] = []; // 依存先が開いているので飛ばした、先に待っている Issue（予約として扱う）
  for (const i of [...args.queued].sort(waitOrder)) {
    if (picked.length >= slots) break;
    if (blockingDeps(i, args.isOpen, args.isStalled, currentFilesOf).length > 0) {
      skipped.push(i);
      continue;
    }
    const files = plannedFiles(i);
    const ahead = skipped.find((s) => overlap(files, plannedFiles(s)).length > 0 && !waitsOn(s, i.number, args.queued));
    if (ahead) {
      addRewait(i, ahead.number, files, `先に待っている #${ahead.number} が同じファイルを変える予定なので、取り出さずに #${ahead.number} を待つ。`);
      continue;
    }
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

/** 割り当ての役の重複（#220）: since より後に、ほかのセッションが factory:dispatch を書いた Issue・PR の番号 */
export function handledByOthers(args: {
  comments: { issue: number; body: string; createdAt: string }[];
  since: string;
  mySession: string | null;
}): number[] {
  const out = new Set<number>();
  for (const c of args.comments) {
    if (c.createdAt <= args.since) continue;
    if (!/^<!--\s*factory:dispatch/.test(c.body)) continue;
    const s = /claude\.ai\/code\/(session_[A-Za-z0-9]+)/.exec(c.body)?.[1] ?? null;
    if (args.mySession && s === args.mySession) continue;
    out.add(c.issue);
  }
  return [...out].sort((a, b) => a - b);
}
