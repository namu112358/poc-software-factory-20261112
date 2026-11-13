// Factory の Routine が使う「着手してよいか・待っている Issue のどれから着手するか」の判定（#137・#218・#220）。
// GitHub への書き込み（ラベルの付け外し・コメント）はしない。判定だけを返し、割り当ての役がその結果に従う。
// 決まりの説明は scripts/factory/README.md、役の手順は .claude/routines/dispatch.md の「1.」。
// 用語: 「待っている Issue」は、status:ready があり status:in-progress / status:in-progress-hard の無い Issue（コード上は queued と呼ぶ。ラベルの queued はもう無い）。ラベルの名前は LABEL。

export const WIP_LIMIT = 4;

/**
 * ラベルの名前。用途のグループを接頭に付けている（status: 流れの状態、kind: Issue の分類、merge: マージの依頼）。
 * 名前を変えるときは、ここと手順書・.mergify.yml・Issue テンプレートを同じ PR で直す。
 */
export const LABEL = {
  ready: "status:ready",
  inProgress: "status:in-progress",
  inProgressHard: "status:in-progress-hard",
  blockedQuestion: "status:blocked-question",
  needsHuman: "status:needs-human",
  epic: "kind:epic",
  kaizen: "kind:kaizen",
  merge: "merge:requested",
  fix: "type:fix",
  riskHigh: "risk:high",
} as const;

/** 接頭を付ける前の名前 → 今の名前。過去のイベント（付けたときの名前のまま残る場合がある）を数えるときだけ使う */
export const OLD_LABEL_NAMES: Readonly<Record<string, string>> = {
  ready: LABEL.ready,
  "in-progress": LABEL.inProgress,
  "in-progress:hard": LABEL.inProgressHard,
  "blocked:question": LABEL.blockedQuestion,
  "needs-human": LABEL.needsHuman,
  epic: LABEL.epic,
  kaizen: LABEL.kaizen,
  merge: LABEL.merge,
};

/** 旧名なら今の名前に直す。それ以外はそのまま */
export function normalizeLabel(name: string): string {
  return OLD_LABEL_NAMES[name] ?? name;
}

/** 実装の開始の合図（実装の Routine のトリガー）。標準と難しい用 */
export const START_LABELS: readonly string[] = [LABEL.inProgress, LABEL.inProgressHard];

/**
 * 実装の Routine の起動のきっかけ（`status:in-progress` / `status:in-progress-hard` が付いたこと）を、直近 60 分に何回まで使うか（#250）。
 * GitHub のイベントには Routine ごとの 1 時間あたりの上限があり、超えたイベントは捨てられる（数値は非公開）。
 * 2026-11-12 は、直近 60 分のきっかけが 53〜55 回になったところで実装の Routine が起動しなくなった。
 * 余裕をみて 45 回にする。上限が分かったら、この値だけを直す。
 * 上限が起動のきっかけ以外のイベント（ほかのラベルなど、フィルタを通る前のもの）も数えるなら、数える対象も見直す。
 * （名前の READY は、きっかけが ready（今の status:ready）だったときの名残り。値の意味は「起動のきっかけ」）
 */
export const READY_EVENTS_PER_HOUR_BUDGET = 45;

/** 直近 60 分のきっかけの数から、あと何回 status:in-progress を付けてよいか */
export function readyBudget(startsLastHour: number): { startsLastHour: number; budget: number; remaining: number } {
  return { startsLastHour, budget: READY_EVENTS_PER_HOUR_BUDGET, remaining: Math.max(0, READY_EVENTS_PER_HOUR_BUDGET - startsLastHour) };
}

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

export type Decision =
  | { decision: "go"; note?: string; ahead?: number[] }
  | { decision: "skip"; reason: string }
  | { decision: "queue" | "retreat"; wait: Wait; files: string[]; reason: string; comment: string };

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

export const STALLED_LABELS: readonly string[] = [LABEL.needsHuman, LABEL.blockedQuestion];
/** 付いていれば着手させないラベル（作業中・人を待っている・実装しない）。#322 */
export const NOT_STARTABLE_LABELS: readonly string[] = [...START_LABELS, ...STALLED_LABELS, LABEL.epic, LABEL.kaizen];

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
 * inProgress: status:in-progress の付いた開いている Issue（自分を含んでいてよい）
 * queued: queued の付いた開いている Issue
 * openPrs: 開いている claude/ の PR
 */
/**
 * `main` の CI が壊れているときの不具合の直し（#363）。同じファイルの待ちより先に着手させる。
 * 依存先・同時に実装する数の上限は、ほかの Issue と同じく守る。
 */
export function isUrgentFix(i: IssueInfo, mainBroken: boolean | undefined): boolean {
  return mainBroken === true && (i.labels ?? []).includes(LABEL.fix);
}

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

export const START_MARK_RE = /<!--\s*factory:implement action=start\s*-->/;

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

/**
 * merge:requested を付けてよいか（#293）。最新の factory:review が verdict=ok で、そのレビューのコミットより後のコミットが
 * すべて「取り込みだけのコミット」（git show --remerge-diff の差分が空のマージ）なら ok。
 * reviews はレビュー（古い順）。印を信じるのは、書き込み権限のある人（author_association が OWNER・MEMBER・COLLABORATOR）のレビューだけ
 * （PR のレビューは誰でも書けるので、ほかの人が印を偽って ok にできないように）。after は、レビューのコミットより後のコミット（first-parent）。
 */
export const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

/** Mergify のキューに入る条件のチェック（.mergify.yml の queue_conditions の check-success と合わせる） */
export const REQUIRED_CHECKS = ["app-check", "pr-body-check"];

/**
 * 最新のコミットで、キューに入る条件のチェックが成功しているか（#364）。
 * 同じ名前のチェックが何度も動いたときは、最後に始まったものを見る。
 */
export function ciCheck(runs: { name: string; status: string; conclusion: string | null; startedAt: string }[]): { ok: boolean; reason: string } {
  for (const name of REQUIRED_CHECKS) {
    const latest = runs
      .filter((r) => r.name === name)
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
      .at(-1);
    if (!latest) return { ok: false, reason: `最新のコミットに ${name} が無い。CI が動くのを待つ（動かないときは、PR 本文を編集すると動き直す）。` };
    if (latest.status !== "completed") return { ok: false, reason: `${name} がまだ終わっていない。終わってから確かめ直す。` };
    if (latest.conclusion !== "success") return { ok: false, reason: `${name} が ${latest.conclusion}。直して、CI が通ってから付ける。` };
  }
  return { ok: true, reason: "" };
}

/**
 * レビューを通ったことを表すコミットの status（context=factory-review）の値（自動でキューに入れる仕組み）。
 * 判定は merge-check のレビューの部分と同じ: 最新のコミットが ok のレビューを受けている（ok の後が取り込みだけのコミットなら引き継ぐ）なら success。
 * 最新のコミットへのレビューが ok でなければ failure。それ以外（レビューの後に中身の変わるコミットがある・レビューが無い）は付けない（null）。
 * risk:high の PR は人が merge:requested を付けてキューに入れるので、success は付けない（レビューの結果と risk:high の付く順が前後しても、自動で入らないように）。
 * 品質のゲート（CI・Mergify・Routine の手順書・判定のスクリプト・エージェントの規約・Ruleset）を変える PR も、success は付けない（人が確かめてマージする）。
 */
// CI の動きを決めるファイル（package.json の test のスクリプト・依存・TypeScript の設定）も含める（書き換えると CI を空にできるため）。
// tests/ は含めない（機能の PR はふつうテストを足す）。テストを外す・緩める変更は、レビューの役が見る（AGENTS.md の規約）。
export const GATE_PATHS = [
  ".mergify.yml",
  ".mergify/",
  ".github/",
  ".claude/",
  "scripts/",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/rulesets/",
  "package.json",
  "package-lock.json",
  ".npmrc",
  "tsconfig.json",
  "tests/factory-claim.test.ts",
];

const matchPaths = (files: string[], paths: string[]) => files.filter((f) => paths.some((g) => (g.endsWith("/") ? f.startsWith(g) : f === g || f.endsWith(`/${g}`))));

export function touchesGate(files: string[]): string[] {
  return matchPaths(files, GATE_PATHS);
}

/**
 * ゲートのパスのうち、2 回目の独立したレビュー（ゲートの監査）でも通さず、今までどおり人が merge:requested を付けるもの（#123 の E27）。
 * CI・Mergify・Ruleset の定義と、監査の仕組み自身（判定のスクリプトと、レビュー・共通の決まりの手順書）。監査の判定を緩める変更が監査だけで通らないようにする。
 */
export const HUMAN_GATE_PATHS = [
  ".github/",
  ".mergify.yml",
  ".mergify/",
  "docs/rulesets/",
  "scripts/factory/claim-core.ts",
  "scripts/factory/claim.ts",
  ".claude/routines/review.md",
  ".claude/routines/README.md",
  // Routine・エージェントの権限と、毎回自動で動く処理（自分で権限を広げられる変更。AGENTS.md の「セキュリティ上重要な設定の変更」）
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".claude/hooks/",
  ".mcp.json",
];

export const touchesHumanGate = (files: string[]): string[] => matchPaths(files, HUMAN_GATE_PATHS);

/** 監査で通すパス: ゲートのパスのうち、人が見るパス以外に当たる変更ファイル */
export const auditPaths = (files: string[]): string[] => touchesGate(files).filter((f) => touchesHumanGate([f]).length === 0);

// ---- ゲートの監査（factory:gate-review）----

/** 書き込み権限のある人のレビューの印（古い順）。session は本文の「セッション: https://claude.ai/code/session_XXXX」。読めなければ null */
export type ReviewMark = { kind: "review" | "gate-review"; verdict: string; commit: string; session: string | null };
export type GateContext = {
  marks: ReviewMark[];
  /** 印のコミット → それより後のコミット（first-parent）。PR の履歴に無ければ null。head と同じなら [] */
  after: Record<string, StalledCommit[] | null>;
  authorSessions: string[]; // PR を出したセッション（PR 本文と、コミットの Claude-Session: の行）
};

export const REVIEW_MARK_RE = /<!--\s*factory:(review|gate-review)\s+verdict=(\w+)[^>]*?commit=([0-9a-f]+)/;

export function parseReviewMark(body: string): Omit<ReviewMark, "session"> | null {
  const m = REVIEW_MARK_RE.exec(body);
  return m ? { kind: m[1] as ReviewMark["kind"], verdict: m[2], commit: m[3] } : null;
}

/** レビュー本文の末尾の「セッション: https://claude.ai/code/session_XXXX」の session_XXXX（最後のもの） */
export const sessionOfReview = (body: string): string | null => [...body.matchAll(/セッション:\s*https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]+)/g)].at(-1)?.[1] ?? null;

/** PR を出したセッション: PR 本文に出てくる session_XXXX と、コミットのメッセージの `Claude-Session:` の行の session_XXXX すべて */
export function authorSessionsOf(prBody: string, commitMessages: string[]): string[] {
  const ids = (t: string) => [...t.matchAll(/session_[A-Za-z0-9]+/g)].map((m) => m[0]);
  const lines = commitMessages.flatMap((m) => [...m.matchAll(/^Claude-Session:.*$/gm)].map((x) => x[0]));
  return [...new Set([...ids(prBody), ...lines.flatMap(ids)])];
}

/** commit の印が、最新のコミット（headSha）か、その後が取り込みだけのコミットだけの版を指しているか */
function coversHead(headSha: string, commit: string, after: GateContext["after"]): boolean {
  if (sameCommit(headSha, commit)) return true;
  const a = after[commit];
  return a != null && a.every((c) => c.mergeOnly);
}

/** 最新のコミット（または、その後が取り込みだけの版）への、最新の factory:review が ok か（merge-check と同じ見方）。ok ならその印 */
function latestOkReview(headSha: string, ctx: GateContext): ReviewMark | null {
  const marks = ctx.marks.filter((m) => m.kind === "review");
  const last = marks.at(-1);
  if (!last || last.verdict !== "ok" || !coversHead(headSha, last.commit, ctx.after)) return null;
  if (marks.some((m) => m.commit === last.commit && m.verdict !== "ok")) return null;
  return last;
}

/** 最新のコミットを覆う factory:gate-review のうち最新の印。無ければ null */
function latestAudit(headSha: string, ctx: GateContext): ReviewMark | null {
  return ctx.marks.filter((m) => m.kind === "gate-review" && coversHead(headSha, m.commit, ctx.after)).at(-1) ?? null;
}

/** ゲートの監査の結果。1 回目のレビューが ok で、変更が監査で通すパスだけのときの判定（reviewStatus の中で使う） */
export function gateAuditStatus(headSha: string, ctx: GateContext | undefined): { state: "success" | "failure" | null; description: string } {
  const wait = { state: null, description: "品質のゲートを変える PR は、2 回目の監査（factory:gate-review）を待つ。" } as const;
  if (!ctx) return wait;
  const audit = latestAudit(headSha, ctx);
  if (!audit) return wait;
  // 同じ版に ok と changes の両方があれば、changes を優先する
  if (audit.verdict !== "ok" || ctx.marks.some((m) => m.kind === "gate-review" && m.commit === audit.commit && m.verdict !== "ok"))
    return { state: "failure", description: "ゲートの監査（factory:gate-review）が changes。直して、監査を起こし直す。" };
  const first = latestOkReview(headSha, ctx);
  if (!audit.session) return { state: null, description: "監査のレビューにセッションの行が無いので、別のセッションか確かめられない。人が確かめる。" };
  if (!first?.session) return { state: null, description: "1 回目のレビューにセッションの行が無いので、監査が別のセッションか確かめられない。人が確かめる。" };
  if (ctx.authorSessions.length === 0) return { state: null, description: "PR を出したセッションが PR 本文・コミットから読めないので、監査が別のセッションか確かめられない。人が確かめる。" };
  if (audit.session === first.session || ctx.authorSessions.includes(audit.session))
    return { state: null, description: "監査が 1 回目のレビュー・PR を出したセッションと同じなので数えない。別のセッションの監査を待つ。" };
  return { state: "success", description: "1 回目のレビューが ok で、別のセッションのゲートの監査も ok。" };
}

export function reviewStatus(mc: ReturnType<typeof mergeCheck>, headSha: string, labels: string[], files: string[] = [], gate?: GateContext): { state: "success" | "failure" | null; description: string } {
  const onHead = mc.review !== null && (headSha.startsWith(mc.review.commit) || mc.review.commit.startsWith(headSha));
  if (mc.ok) {
    if (labels.includes(LABEL.riskHigh)) return { state: null, description: "risk:high の PR は、人が merge:requested を付けてキューに入れる。" };
    const human = touchesHumanGate(files);
    if (human.length > 0) return { state: null, description: `人が見るパス（${human.slice(0, 3).join("、")}）を変える PR は、人が確かめて merge:requested を付ける。` };
    if (auditPaths(files).length > 0) return gateAuditStatus(headSha, gate);
    return { state: "success", description: mc.reason };
  }
  if (onHead && mc.review !== null && mc.review.verdict !== "ok") return { state: "failure", description: mc.reason };
  return { state: null, description: mc.reason };
}

export type ReviewMode = {
  pr: number;
  mode: "stop" | "review" | "gate-review";
  reason: string;
  gatePaths: string[];
  firstReviewSession: string | null;
  authorSessions: string[];
};

/** 最新のコミットに、ゲートの監査が要るのに無いか（要るなら、1 回目の ok のレビューの印を返す）。自分のセッションは見ない（stalled が使う） */
export function auditNeeded(input: { headSha: string; labels: string[]; files: string[]; ctx: GateContext }): ReviewMark | null {
  const { headSha, labels, files, ctx } = input;
  if (labels.includes(LABEL.riskHigh) || auditPaths(files).length === 0 || touchesHumanGate(files).length > 0) return null;
  const first = latestOkReview(headSha, ctx);
  if (!first || latestAudit(headSha, ctx)) return null;
  return first;
}

/**
 * review.md の最初に実行する review-mode の判定。stop なら何もせず終え、review は通常のレビュー、gate-review はゲートの監査だけを行う。
 * 上から最初に当たったもの: 1 閉じている・draft・claude/ でない・フォーク・needs-human は stop、2 最新のコミットへの factory:review が無ければ review、
 * 3 factory:review が ok で監査が要る（auditNeeded）のに無ければ、自分が 1 回目のレビューか PR を出したセッションなら stop（自分のセッションが読めなくても stop）・そうでなければ gate-review、4 それ以外は stop。
 */
export function reviewMode(input: {
  pr: number;
  open: boolean;
  draft: boolean;
  headRef: string;
  headRepoSame: boolean;
  headSha: string;
  labels: string[];
  files: string[];
  ctx: GateContext;
  mySession: string | null;
}): ReviewMode {
  const { ctx, headSha } = input;
  const gatePaths = auditPaths(input.files);
  const base = { pr: input.pr, gatePaths, firstReviewSession: null as string | null, authorSessions: ctx.authorSessions };
  const stop = (reason: string, first: string | null = null): ReviewMode => ({ ...base, mode: "stop", reason, firstReviewSession: first });
  if (!input.open) return stop("PR が閉じている。");
  if (input.draft) return stop("PR が draft。");
  if (!input.headRef.startsWith("claude/")) return stop("head のブランチが claude/ で始まらない。");
  if (!input.headRepoSame) return stop("フォークの PR。");
  if (input.labels.includes(LABEL.needsHuman)) return stop("status:needs-human が付いている。");
  const reviews = ctx.marks.filter((m) => m.kind === "review");
  const lastOk = reviews.filter((m) => m.verdict === "ok").at(-1);
  const reviewed = reviews.some((m) => sameCommit(m.commit, headSha)) || (lastOk !== undefined && coversHead(headSha, lastOk.commit, ctx.after));
  if (!reviewed) return { ...base, mode: "review", reason: "最新のコミットへの factory:review が無い。通常のレビューをする。" };
  const first = auditNeeded({ headSha, labels: input.labels, files: input.files, ctx });
  if (!first) return stop("最新のコミットは、レビュー済みで、ゲートの監査も要らない（または済んでいる）。", latestOkReview(headSha, ctx)?.session ?? null);
  const firstSession = first.session;
  if (!input.mySession) return stop("自分のセッションが読めないので、監査が別のセッションか確かめられない。", firstSession);
  if (input.mySession === firstSession || ctx.authorSessions.includes(input.mySession))
    return stop("自分が 1 回目のレビュー（または PR を出した）セッションなので、監査はしない。別のセッションが行う。", firstSession);
  return { ...base, mode: "gate-review", reason: "ゲートの監査が要る。別のセッションの自分が行う。", firstReviewSession: firstSession };
}

export function mergeCheck(args: {
  reviews: { body: string; association: string }[];
  headSha: string;
  after: { sha: string; mergeOnly: boolean }[] | null; // null: レビューのコミットが PR の履歴に無い
}): { ok: boolean; reason: string; review: { verdict: string; commit: string } | null } {
  const marks = args.reviews
    .filter((r) => TRUSTED_ASSOCIATIONS.includes(r.association))
    .map((r) => r.body)
    .map((b) => /<!--\s*factory:review\s+verdict=(\w+)[^>]*?commit=([0-9a-f]+)/.exec(b))
    .filter((m): m is RegExpExecArray => m !== null);
  const last = marks.at(-1);
  if (!last) return { ok: false, reason: "factory:review のレビューが 1 つも無い。レビューの Routine を起こしてから（PR を draft にして Ready に戻す）付ける。", review: null };
  const review = { verdict: last[1], commit: last[2] };
  if (review.verdict !== "ok") return { ok: false, reason: `最新のレビューが verdict=${review.verdict}。直して ok になるまで付けない。`, review };
  // 同じ版に 2 つのレビューが付くことがある（Ready のイベントが重なったとき）。後の ok が、先の必須の指摘を打ち消さないようにする
  if (marks.some((m) => m[2] === review.commit && m[1] !== "ok"))
    return { ok: false, reason: `同じ版（${review.commit.slice(0, 7)}）に verdict=changes のレビューもある。指摘を直して、レビューを起こし直す。`, review };
  if (args.headSha.startsWith(review.commit) || review.commit.startsWith(args.headSha)) return { ok: true, reason: "最新のコミットが ok のレビューを受けている。", review };
  if (args.after === null) return { ok: false, reason: `レビューのコミット ${review.commit} が PR の履歴に見つからない。レビューを起こし直す。`, review };
  const changed = args.after.filter((c) => !c.mergeOnly).map((c) => c.sha.slice(0, 7));
  if (changed.length > 0) return { ok: false, reason: `ok のレビューの後に中身の変わるコミット（${changed.join("、")}）がある。レビューを起こし直す（PR を draft にして Ready に戻す）。`, review };
  return { ok: true, reason: "ok のレビューの後は、取り込みだけのコミットだけ。", review };
}

// ---- 止まった実装・PR の片付け（`claim.ts stalled`。割り当ての「3.」・巡回の「1.」） ----

export type StalledCommit = { sha: string; mergeOnly: boolean };
export type CheckState = "success" | "failure" | "pending" | "none";

export type StalledPr = {
  number: number;
  headRef: string;
  headSha: string;
  draft: boolean;
  mergeable: boolean | null;
  labels: string[]; // 今の名前に直したラベル
  updatedAt: string; // PR の updated_at
  readyAt: string | null; // 最後に Ready になった時刻（timeline の ready_for_review。無ければ PR を作った時刻）
  appCheck: CheckState; // 最新のコミットの app-check の最新の実行
  reviews: { verdict: string; commit: string }[]; // 書き込み権限のある人の factory:review（古い順）
  /** レビューのコミット → それより後のコミット（first-parent）。PR の履歴に無ければ null。head と同じなら [] */
  after: Record<string, StalledCommit[] | null>;
  priorMarks: { action: string; commit: string }[]; // 割り当て・巡回の `action=<処置> commit=<sha>` のコメント（書き込み権限のある人のもの）。同じ処置のくり返しを数える
  bodyCheck: CheckState; // 最新のコミットの pr-body-check の最新の実行
  auditWait?: { since: string } | null; // ゲートの監査が要るのに無いとき、1 回目の ok のレビューの時刻（auditNeeded）
  mergifyTimeout: { at: string } | null; // Mergify の状況のコメントの dequeue_reason.code が CHECKS_TIMEOUT のとき、外れた時刻
};
export type StalledIssue = { number: number; labels: string[]; updatedAt: string };

export type StalledAction = {
  target: "pr" | "issue";
  number: number;
  action: string;
  removeLabels: string[];
  addLabels: string[];
  draft: null | "to-draft" | "to-ready" | "draft-then-ready" | "ready-then-draft";
  issue: null | { number: number; removeLabels: string[]; addLabels: string[] };
  comment: string | null;
};

const ISSUE_BRANCH_RE = /^claude\/issue-(\d+)$/;
const sameCommit = (a: string, b: string) => a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a));
const minutesSince = (at: string, now: string) => (new Date(now).getTime() - new Date(at).getTime()) / 60000;

/** 最新のコミットが、ok のレビューを受けているか、その後が取り込みだけのコミットだけか（merge-check の ok と同じ見方） */
function okCoversHead(pr: StalledPr): boolean {
  const ok = pr.reviews.filter((r) => r.verdict === "ok").at(-1);
  if (!ok) return false;
  if (sameCommit(pr.headSha, ok.commit)) return true;
  const after = pr.after[ok.commit];
  return after != null && after.every((c) => c.mergeOnly);
}

/** 最新のレビューより後に、取り込みだけでないコミットがあるか（レビューが無ければ true）。履歴に見つからなければ true */
function changedAfterLatestReview(pr: StalledPr): boolean {
  const last = pr.reviews.at(-1);
  if (!last) return true;
  if (sameCommit(pr.headSha, last.commit)) return false;
  const after = pr.after[last.commit];
  return after == null || after.some((c) => !c.mergeOnly);
}

const AUDIT_STALLED_TEXT = "ゲートの監査が動かなかったので起こし直した。";

export function stalledComment(role: string, action: string, text: string, sessionUrl: string | null, commit?: string): string {
  const mark = `<!-- factory:${role} action=${action}${commit ? ` commit=${commit}` : ""} -->`;
  return [mark, text, ...(sessionUrl ? [`セッション: ${sessionUrl}`] : [])].join("\n");
}

/**
 * 止まった実装・PR の判定（dispatch.md・patrol.md の表を 1 つにしたもの）。GitHub には書かず、役が行う操作だけを返す。
 * 1 つの PR・Issue に当てはまる処置は、行の順（1〜9）で最初の 1 つだけ。mergeable が null の PR は unknown に入れ、ほかの行も判定しない。
 * 対象: claude/ の PR（claude/issue- 以外は「衝突」の行だけ）。PR に status:needs-human、その Issue に blocked-question・needs-human・kind:epic があるものは対象外。
 * issues: 開いていて status:in-progress（-hard）が付いた Issue と、PR の Issue（PR の Issue は prs の headRef から引く）。
 * closedStarted: 閉じた Issue のうち、status:in-progress（-hard）が残っているもの（行 10）。
 */
export function stalledActions(input: {
  role: string;
  now: string;
  sessionUrl: string | null;
  prs: StalledPr[];
  issues: StalledIssue[];
  closedStarted: { number: number; labels: string[] }[];
}): { role: string; now: string; actions: StalledAction[]; unknown: { pr: number; reason: string }[] } {
  const { role, now, sessionUrl } = input;
  const actions: StalledAction[] = [];
  const unknown: { pr: number; reason: string }[] = [];
  const humanWaiting: string[] = [LABEL.blockedQuestion, LABEL.needsHuman, LABEL.epic];
  const issueByNumber = new Map(input.issues.map((i) => [i.number, i]));
  const startOf = (labels: string[]) => START_LABELS.filter((l) => labels.includes(l));
  const note = (text: string, action: string, commit?: string) => stalledComment(role, action, text, sessionUrl, commit);
  const handledIssues = new Set<number>();

  for (const pr of input.prs) {
    const m = ISSUE_BRANCH_RE.exec(pr.headRef);
    const issueNo = m ? Number(m[1]) : null;
    const issue = issueNo !== null ? issueByNumber.get(issueNo) : undefined;
    if (issueNo !== null) handledIssues.add(issueNo);
    if (pr.labels.includes(LABEL.needsHuman)) continue;
    if (issue && issue.labels.some((l) => humanWaiting.includes(l))) continue;
    const idle = Math.min(
      minutesSince(pr.updatedAt, now),
      issue ? minutesSince(issue.updatedAt, now) : Infinity,
    );
    const started = issue ? startOf(issue.labels) : [];
    const base = { target: "pr" as const, number: pr.number, removeLabels: [] as string[], addLabels: [] as string[], issue: null };
    const push = (a: Partial<StalledAction> & { action: string; comment: string | null }) => {
      actions.push({ ...base, draft: null, ...a });
    };
    const toHuman = (action: string, text: string, commit?: string) =>
      push({ action, addLabels: [LABEL.needsHuman], comment: note(text, action, commit) });
    const sha7 = pr.headSha.slice(0, 7);
    // 同じコミットに同じ処置を 2 回しない。2 回目は draft の切り替えをせず、人に回す
    const once = (a: Partial<StalledAction> & { action: string }, text: string) => {
      if (pr.priorMarks.some((m) => m.action === a.action && sameCommit(m.commit, pr.headSha)))
        push({ action: a.action, addLabels: [LABEL.needsHuman], comment: stalledComment(role, `${a.action}-repeat`, `同じ処置（${a.action}）を同じコミットに 2 回しても動かないので、人に回す。`, sessionUrl, sha7) });
      else push({ ...a, comment: note(text, a.action, sha7) });
    };
    const stopIssue = (text: string) => {
      actions.push({
        target: "issue",
        number: issue!.number,
        action: "stalled",
        removeLabels: started,
        addLabels: [LABEL.needsHuman],
        draft: null,
        issue: null,
        comment: note(text, "stalled"),
      });
    };

    if (issueNo === null && role !== "dispatch") continue; // claude/issue- 以外の PR は、割り当ての衝突の知らせだけ（巡回は扱わない）
    if (pr.mergeable === null) {
      unknown.push({ pr: pr.number, reason: "mergeable が null" });
      continue;
    }
    // 1・2: 衝突
    if (!pr.draft && pr.mergeable === false) {
      once({ action: "conflict", draft: "to-draft" }, "`main` と衝突しているので draft に戻した。衝突を直して Ready に戻す。");
      continue;
    }
    // ゲートの監査が動かなかった（1 回目の ok の後、監査が 10 分たっても来ない）。監査は出したセッションが自分でできないので、claude/issue- 以外の PR も対象
    const auditStalled = !pr.draft && !!pr.auditWait && minutesSince(pr.auditWait.since, now) >= 10;
    if (issueNo === null) {
      if (auditStalled) once({ action: "rereview", draft: "draft-then-ready" }, AUDIT_STALLED_TEXT);
      continue; // それ以外は、衝突の行だけ
    }
    if (pr.draft && pr.mergeable === false && idle >= 30) {
      once({ action: "conflict-kick", draft: "ready-then-draft" }, "衝突したまま止まっているので、修正の役を起こし直した。");
      continue;
    }
    // 3: レビューが動かなかった
    const reviewStalled = !pr.draft && !pr.reviews.some((r) => sameCommit(r.commit, pr.headSha)) && !okCoversHead(pr) && pr.readyAt && minutesSince(pr.readyAt, now) >= 10;
    if (reviewStalled || auditStalled) {
      once({ action: "rereview", draft: "draft-then-ready" }, reviewStalled ? "レビューが動かなかったので起こし直した。" : AUDIT_STALLED_TEXT);
      continue;
    }
    // 4: 必須の指摘が直されないまま
    const latest = pr.reviews.at(-1);
    if (pr.draft && latest?.verdict === "changes" && sameCommit(latest.commit, pr.headSha) && idle >= 30) {
      toHuman("changes-stuck", "必須の指摘が直されないまま止まっているので、人に回す。");
      continue;
    }
    // 5: CI が通ったまま止まった draft
    if (pr.draft && pr.appCheck === "success" && changedAfterLatestReview(pr) && pr.mergeable === true && idle >= 15) {
      once(
        { action: "ready-stalled", draft: "to-ready", issue: started.length ? { number: issue!.number, removeLabels: started, addLabels: [] } : null },
        "CI が通ったまま止まっていたので Ready にした（レビューの役が動く）。",
      );
      continue;
    }
    // 6・7: 作業中の印が付いたまま止まった Issue
    if (issue && started.length && pr.draft) {
      if (pr.appCheck === "failure" && idle >= 30) {
        stopIssue("CI が落ちたまま 30 分動きが無いので、人に回す。");
        continue;
      }
      if (idle >= 60) {
        stopIssue("60 分動きが無いので、人に回す。");
        continue;
      }
    }
    // 8: 作業中の印が無く、CI が通らないまま止まった draft
    if (pr.draft && pr.appCheck !== "success" && started.length === 0 && idle >= 60) {
      toHuman("stalled-ci", "CI が通らないまま止まっているので、人に回す。");
      continue;
    }
    // 9: Mergify の時間切れで外れ、その後 CI も レビューも通っている
    const dequeued = pr.labels.some((l) => l === "merge:dequeued" || l === "dequeued");
    // merge:requested で入った PR も、レビューの status で自動で入った PR も同じ（Mergify は、キューに入っていた PR にだけ dequeued を付ける）
    if (dequeued && pr.mergifyTimeout && minutesSince(pr.mergifyTimeout.at, now) >= 5 && pr.appCheck === "success" && pr.bodyCheck === "success" && okCoversHead(pr)) {
      toHuman("checks-timeout", "Mergify の時間切れでキューから外れた。その後 CI は成功し、レビューも ok。人が `merge:requested` を付ける（付いていれば外して付け直す）と入り直す。");
      continue;
    }
  }

  // 7（PR が無い Issue）。PR がある Issue は上の PR の判定で扱った
  for (const issue of input.issues) {
    if (handledIssues.has(issue.number)) continue;
    const started = startOf(issue.labels);
    if (started.length === 0 || issue.labels.some((l) => humanWaiting.includes(l))) continue;
    if (minutesSince(issue.updatedAt, now) >= 60) {
      actions.push({
        target: "issue",
        number: issue.number,
        action: "stalled",
        removeLabels: started,
        addLabels: [LABEL.needsHuman],
        draft: null,
        issue: null,
        comment: stalledComment(role, "stalled", "60 分動きが無いので、人に回す。", sessionUrl),
      });
    }
  }
  // 10: 閉じた Issue に残った印
  for (const c of input.closedStarted) {
    const started = START_LABELS.filter((l) => c.labels.includes(l));
    if (started.length) actions.push({ target: "issue", number: c.number, action: "cleanup", removeLabels: started, addLabels: [], draft: null, issue: null, comment: null });
  }
  return { role, now, actions, unknown };
}
