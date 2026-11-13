// Factory の Routine が使う判定のスクリプト（GitHub を読むだけ。書き込みはしない）。
// 使い方（結果は JSON で標準出力に出る。役は decision に従い、ラベルとコメントを GitHub MCP で変える）:
//   node scripts/factory/claim.ts pick                                  待っている Issue（status:ready あり・status:in-progress なし）のうち、着手させる候補
//   node scripts/factory/claim.ts precheck <Issue> --files a.ts,b.ts   候補 1 件を着手させてよいかの確かめ（actions に、そのまま行う操作）
//   node scripts/factory/claim.ts relabel --minutes 15                  起動しなかった実装の付け直しの対象（付け直す数は budget の残りまで）
//   node scripts/factory/claim.ts handled --since <ISO 8601>            ほかの割り当てがもう処理した Issue・PR
//   node scripts/factory/claim.ts merge-check <PR>                      merge:requested のラベルを付けてよいか（最新のレビューが ok で、その後は取り込みだけか）
//   node scripts/factory/claim.ts review-status <PR>                    レビューを通ったことを表す status（factory-review）の値（success・failure・null）。GitHub Actions が使う
//   node scripts/factory/claim.ts stalled --role dispatch|patrol       止まった実装・PR の片付け（actions に、そのまま行う操作。unknown は 1 分後にもう一度）
//   node scripts/factory/claim.ts gate --role implement|review|fix --number <N>   実装・レビュー・修正が起動してよいか（decision と、役が行う ops）
//   node scripts/factory/claim.ts budget                                直近 60 分に status:in-progress を付けた回数と、あと何回付けてよいか
// Node 22.18 以上（型を外して .ts をそのまま動かす）。クラウドのプロキシを通すため、NODE_USE_ENV_PROXY=1 で自分を起動し直す。
import { spawnSync } from "node:child_process";
import {
  dependencies,
  gateDecision,
  settleMergeable,
  type GateInput,
  type GateReview,
  handledByOthers,
  makeIsStalled,
  pick,
  STALLED_LABELS,
  stalledActions,
  type StalledPr,
  type StalledIssue,
  type StalledCommit,
  type CheckState,
  START_LABELS,
  LABEL,
  normalizeLabel,
  errorActions,
  mergeCheck,
  reviewStatus,
  auditNeeded,
  auditPaths,
  parseReviewMark,
  sessionOfReview,
  authorSessionsOf,
  type GateContext,
  type ReviewMark,
  ciCheck,
  TRUSTED_ASSOCIATIONS,
  precheck,
  precheckActions,
  readyBudget,
  relabelTargets,
  splitFiles,
  type Comment,
  type IssueInfo,
  type PrInfo,
} from "./claim-core.ts";

const REPO = process.env.FACTORY_REPO ?? "namu112358/poc-software-factory-20261112";
const API = "https://api.github.com";

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" },
  });
  process.exit(r.status ?? 1);
}

type RawIssue = { number: number; body: string | null; state: string; pull_request?: unknown; labels?: { name: string }[] };
type RawComment = { body: string | null; created_at: string; issue_url: string; user?: { login: string } };

async function get<T>(path: string): Promise<{ status: number; data: T }> {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`${API}${path}`, {
    // GitHub Actions の中では GITHUB_TOKEN で読む（クラウドのセッションでは、プロキシが認証を付ける）
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 404) return { status: 404, data: [] as T };
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return { status: res.status, data: (await res.json()) as T };
}

async function getAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const { data } = await get<T[]>(`${path}${sep}per_page=100&page=${page}`);
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

const openCache = new Map<number, boolean>();
const labelCache = new Map<number, string[]>();
const prIssueCache = new Map<number, number>(); // PR の番号 → その Issue（claude/issue-<番号>）の番号
const issueOf = (ref: string) => Number(/^claude\/issue-(\d+)$/.exec(ref)?.[1] ?? NaN);
async function loadOpen(numbers: number[]): Promise<void> {
  for (const n of numbers) {
    if (openCache.has(n)) continue;
    const { status, data } = await get<RawIssue>(`/repos/${REPO}/issues/${n}`);
    const raw = data as RawIssue;
    openCache.set(n, status !== 404 && raw.state === "open");
    labelCache.set(n, status === 404 ? [] : (raw.labels ?? []).map((l) => l.name));
    if (status !== 404 && raw.pull_request) {
      // 待ち先が PR なら、その Issue のラベルも読む（止まった印は Issue に付くことが多い）
      const pr = (await get<{ head: { ref: string } }>(`/repos/${REPO}/pulls/${n}`)).data;
      const issue = issueOf(pr.head?.ref ?? "");
      if (Number.isInteger(issue)) {
        prIssueCache.set(n, issue);
        await loadOpen([issue]);
      }
    }
  }
}
const isOpen = (n: number) => openCache.get(n) ?? false;
/** Issue か PR（番号）が status:needs-human・status:blocked-question で人を待っているか（#255） */
const isStalled = (n: number) => makeIsStalled(labelCache, prIssueCache)(n);

async function loadIssue(n: number, raw?: RawIssue): Promise<IssueInfo> {
  const issue = raw ?? (await get<RawIssue>(`/repos/${REPO}/issues/${n}`)).data;
  const comments = await getAll<RawComment>(`/repos/${REPO}/issues/${n}/comments`);
  const blocked = await getAll<RawIssue>(`/repos/${REPO}/issues/${n}/dependencies/blocked_by`);
  return {
    number: n,
    body: issue.body ?? "",
    comments: comments.map((c): Comment => ({ body: c.body ?? "", createdAt: c.created_at, author: c.user?.login })),
    blockedBy: blocked.map((b) => b.number),
    labels: (issue.labels ?? []).map((l) => normalizeLabel(l.name)),
  };
}

/** 待っている Issue から外すラベル（作業中・人を待っている・実装しない） */
const NOT_WAITING_LABELS = [...START_LABELS, ...STALLED_LABELS, LABEL.epic, LABEL.kaizen];

async function loadLabeled(label: string): Promise<IssueInfo[]> {
  const raws = (await getAll<RawIssue>(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(label)}`)).filter((i) => !i.pull_request);
  return Promise.all(raws.map((r) => loadIssue(r.number, r)));
}

/** 作業中の Issue: status:in-progress か status:in-progress-hard が付いた開いている Issue */
async function loadInProgress(): Promise<IssueInfo[]> {
  const lists = await Promise.all(START_LABELS.map(loadLabeled));
  const byNumber = new Map(lists.flat().map((i) => [i.number, i]));
  return [...byNumber.values()];
}

/** 待っている Issue: status:ready があり、作業中・人待ち・Epic・kaizen のラベルが無い開いている Issue */
async function loadWaiting(): Promise<IssueInfo[]> {
  const raws = (await getAll<RawIssue>(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL.ready)}`)).filter(
    (i) => !i.pull_request && !(i.labels ?? []).some((l) => NOT_WAITING_LABELS.includes(l.name)),
  );
  return Promise.all(raws.map((r) => loadIssue(r.number, r)));
}

/** main の最新のコミットの app-check が失敗しているか（#363）。読めなければ false（ふだんどおり待たせる） */
async function loadMainBroken(): Promise<boolean> {
  const { status, data } = await get<{ check_runs?: { name: string; conclusion: string | null; started_at: string }[] }>(`/repos/${REPO}/commits/main/check-runs?check_name=app-check`);
  if (status !== 200) return false;
  const latest = (data.check_runs ?? []).sort((a, b) => (a.started_at < b.started_at ? -1 : 1)).at(-1);
  return latest?.conclusion === "failure";
}

async function loadOpenPrs(): Promise<PrInfo[]> {
  const prs = await getAll<{ number: number; head: { ref: string }; labels?: { name: string }[] }>(`/repos/${REPO}/pulls?state=open`);
  const mine = prs.filter((p) => p.head.ref.startsWith("claude/"));
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

async function ownPr(n: number): Promise<number | null> {
  const owner = REPO.split("/")[0];
  const prs = await getAll<{ number: number }>(`/repos/${REPO}/pulls?state=open&head=${owner}:claude/issue-${n}`);
  return prs[0]?.number ?? null;
}

/** 直近 60 分に status:in-progress / status:in-progress-hard が付いた回数（実装の Routine の起動のきっかけ。#250） */
async function loadBudget() {
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

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function mySession(): string | null {
  const m = /cse_([A-Za-z0-9]+)/.exec(process.env.CLAUDE_CODE_REMOTE_SDK_URL ?? "");
  return m ? `session_${m[1]}` : null;
}

const git = (...a: string[]) => spawnSync("git", a, { encoding: "utf-8" });

/**
 * レビューのコミット（last）より後の PR のコミット（first-parent）と、それが「取り込みだけのコミット」か。
 * head が last と同じなら []。last が PR の履歴に無ければ null。手元の参照が古い・fetch に失敗したときは例外（付けずに、後でやり直す）。
 * merge-check と stalled が使う。
 */
function commitsAfter(n: number, last: string, headSha: string): StalledCommit[] | null {
  if (headSha.startsWith(last)) return [];
  const fetched = git("fetch", "-q", "origin", `+pull/${n}/head:refs/factory/pr-${n}`, "+main:refs/factory/main");
  if (fetched.status !== 0) throw new Error(`git fetch に失敗した（${fetched.stderr.trim()}）。付けずに、後でやり直す。`);
  // 手元の参照が古いまま判定しないよう、取り込んだ PR の先頭が GitHub の head と同じかを確かめる
  const local = git("rev-parse", `refs/factory/pr-${n}`).stdout.trim();
  if (local !== headSha) throw new Error(`手元の PR の先頭（${local.slice(0, 7)}）が GitHub の head（${headSha.slice(0, 7)}）と違う。付けずに、後でやり直す。`);
  const list = git("rev-list", "--first-parent", `${last}..refs/factory/pr-${n}`);
  if (list.status !== 0) return null;
  return list.stdout.split("\n").filter(Boolean).map((sha) => {
    const parents = git("rev-list", "--parents", "-n1", sha).stdout.trim().split(" ").slice(1);
    const diff = git("show", "--format=", "--remerge-diff", sha).stdout.trim();
    // 取り込みだけのコミット: main を取り込んだ（2 つ目の親が main に含まれる）マージで、--remerge-diff の差分が空
    const fromMain = parents.length === 2 && git("merge-base", "--is-ancestor", parents[1], "refs/factory/main").status === 0;
    return { sha, mergeOnly: fromMain && diff === "", merge: fromMain };
  });
}

const COMMIT_MARK_RE = /<!--\s*factory:review\s+verdict=(\w+)[^>]*?commit=([0-9a-f]+)/;
type RawPull = { number: number; body?: string | null; draft: boolean; mergeable?: boolean | null; created_at: string; updated_at: string; head: { ref: string; sha: string; repo?: { full_name: string } | null }; labels?: { name: string }[] };
type RawTrustedComment = { body: string | null; updated_at: string; author_association: string; user?: { login: string } };

/**
 * ゲートの監査の判定に要る値を集める（読むだけ）。書き込み権限のある人の factory:review・factory:gate-review の印とセッション、
 * 印のコミットより後のコミット、PR を出したセッション（PR 本文と、コミットの Claude-Session: の行）。okAt は、最新の 1 回目の ok のレビューの時刻。
 */
async function loadGateContext(n: number, headSha: string, prBody: string): Promise<{ ctx: GateContext; okAt: string | null }> {
  const raw = (await getAll<{ body: string | null; submitted_at: string; author_association: string }>(`/repos/${REPO}/pulls/${n}/reviews`))
    .sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1))
    .filter((r) => TRUSTED_ASSOCIATIONS.includes(r.author_association));
  const found = raw.flatMap((r) => {
    const m = parseReviewMark(r.body ?? "");
    return m ? [{ mark: { ...m, session: sessionOfReview(r.body ?? "") } as ReviewMark, at: r.submitted_at }] : [];
  });
  const marks = found.map((f) => f.mark);
  const reviews = marks.filter((m) => m.kind === "review");
  const commits = new Set<string>([reviews.at(-1)?.commit, reviews.filter((m) => m.verdict === "ok").at(-1)?.commit, ...marks.filter((m) => m.kind === "gate-review").map((m) => m.commit)].filter((c): c is string => !!c));
  const after: GateContext["after"] = {};
  for (const c of commits) after[c] = commitsAfter(n, c, headSha);
  const msgs = (await getAll<{ commit: { message: string } }>(`/repos/${REPO}/pulls/${n}/commits`)).map((c) => c.commit.message);
  const lastOk = found.filter((f) => f.mark.kind === "review" && f.mark.verdict === "ok").at(-1);
  return { ctx: { marks, after, authorSessions: authorSessionsOf(prBody, msgs) }, okAt: lastOk?.at ?? null };
}

const filesOf = async (n: number) =>
  (await getAll<{ filename: string; previous_filename?: string }>(`/repos/${REPO}/pulls/${n}/files`)).flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]);

/** 止まった実装・PR の判定の入力を GitHub と git から集める（読むだけ） */
async function loadStalled(role: string) {
  const list = (await getAll<RawPull>(`/repos/${REPO}/pulls?state=open`)).filter((p) => p.head.ref.startsWith("claude/"));
  const prs: StalledPr[] = [];
  const unknown: { pr: number; reason: string }[] = [];
  const issues = new Map<number, StalledIssue>();
  const addIssue = (raw: { number: number; labels?: { name: string }[]; updated_at?: string }) =>
    issues.set(raw.number, { number: raw.number, labels: (raw.labels ?? []).map((l) => normalizeLabel(l.name)), updatedAt: raw.updated_at ?? "" });
  for (const label of START_LABELS) {
    for (const i of (await getAll<RawIssue & { updated_at: string }>(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(label)}`)).filter((x) => !x.pull_request)) addIssue(i);
  }
  for (const p of list) {
    const no = issueOf(p.head.ref);
    if (Number.isInteger(no) && !issues.has(no)) {
      const { status, data } = await get<RawIssue & { updated_at: string }>(`/repos/${REPO}/issues/${no}`);
      if (status !== 404) addIssue(data);
    }
  }
  for (const p of list) {
    const n = p.number;
    const own = Number.isInteger(issueOf(p.head.ref));
    const full = (await get<RawPull>(`/repos/${REPO}/pulls/${n}`)).data; // 一覧には mergeable が入らない
    const labels = (full.labels ?? []).map((l) => normalizeLabel(l.name));
    const mergeable = full.mergeable ?? null;
    let appCheck: CheckState = "none";
    let reviews: StalledPr["reviews"] = [];
    let after: StalledPr["after"] = {};
    let readyAt: string | null = null;
    let priorMarks: StalledPr["priorMarks"] = [];
    let bodyCheck: CheckState = "none";
    let mergifyTimeout: StalledPr["mergifyTimeout"] = null;
    let auditWait: StalledPr["auditWait"] = null;
    try {
      if (mergeable !== null && !full.draft) {
        // ゲートの監査が要るのに来ない PR（claude/issue- 以外の claude/ の PR も）。変更が監査で通すパスに当たるときだけ、くわしく読む
        const files = await filesOf(n);
        if (auditPaths(files).length > 0) {
          const { ctx, okAt } = await loadGateContext(n, full.head.sha, full.body ?? "");
          if (okAt && auditNeeded({ headSha: full.head.sha, labels, files, ctx })) auditWait = { since: okAt };
        }
      }
      if (mergeable !== null) {
        const comments = (await getAll<RawTrustedComment>(`/repos/${REPO}/issues/${n}/comments`)).filter((c) => TRUSTED_ASSOCIATIONS.includes(c.author_association));
        priorMarks = comments
          .map((c) => /factory:(?:dispatch|patrol) action=([\w-]+) commit=([0-9a-f]+)/.exec(c.body ?? ""))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => ({ action: m[1], commit: m[2] }));
      }
      if (mergeable !== null && own) {
        const checkState = async (name: string): Promise<CheckState> => {
          const runs = (await get<{ check_runs: { status: string; conclusion: string | null; started_at: string }[] }>(`/repos/${REPO}/commits/${full.head.sha}/check-runs?check_name=${name}&per_page=100`)).data.check_runs ?? [];
          const latest = runs.sort((a, b) => (a.started_at < b.started_at ? -1 : 1)).at(-1);
          return !latest ? "none" : latest.status !== "completed" ? "pending" : latest.conclusion === "success" ? "success" : "failure";
        };
        appCheck = await checkState("app-check");
        bodyCheck = await checkState("pr-body-check");
        reviews = (await getAll<{ body: string | null; submitted_at: string; author_association: string }>(`/repos/${REPO}/pulls/${n}/reviews`))
          .sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1))
          .filter((r) => TRUSTED_ASSOCIATIONS.includes(r.author_association))
          .map((r) => COMMIT_MARK_RE.exec(r.body ?? ""))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => ({ verdict: m[1], commit: m[2] }));
        for (const commit of new Set([reviews.at(-1)?.commit, reviews.filter((r) => r.verdict === "ok").at(-1)?.commit])) {
          if (commit) after[commit] = commitsAfter(n, commit, full.head.sha);
        }
        if (!full.draft) {
          const tl = await getAll<{ event: string; created_at: string }>(`/repos/${REPO}/issues/${n}/timeline`);
          readyAt = tl.filter((e) => e.event === "ready_for_review").at(-1)?.created_at ?? full.created_at;
        }
        if (labels.some((l) => l === "merge:dequeued" || l === "dequeued")) {
          const comments = await getAll<RawTrustedComment>(`/repos/${REPO}/issues/${n}/comments`);
          // Mergify のボットの状況のコメントだけを読む（ほかの人が同じ文字を書いても、判定に使わない）
          const m = comments.filter((c) => c.user?.login === "mergify[bot]" && /dequeue_reason[\s\S]{0,300}?CHECKS_TIMEOUT/.test(c.body ?? "")).at(-1);
          if (m) mergifyTimeout = { at: m.updated_at };
        }
      }
    } catch (e) {
      unknown.push({ pr: n, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    prs.push({ number: n, headRef: full.head.ref, headSha: full.head.sha, draft: full.draft, mergeable, labels, updatedAt: full.updated_at, readyAt, appCheck, reviews, after, priorMarks, bodyCheck, mergifyTimeout, auditWait });
  }
  const closed = (await get<(RawIssue & { updated_at: string })[]>(`/repos/${REPO}/issues?state=closed&per_page=100&sort=updated&direction=desc`)).data.filter((i) => !i.pull_request);
  const closedStarted = closed.map((i) => ({ number: i.number, labels: (i.labels ?? []).map((l) => normalizeLabel(l.name)) })).filter((i) => i.labels.some((l) => START_LABELS.includes(l)));
  const sessionId = mySession();
  const r = stalledActions({ role, now: new Date().toISOString(), sessionUrl: sessionId ? `https://claude.ai/code/${sessionId}` : null, prs, issues: [...issues.values()], closedStarted });
  return { ...r, unknown: [...r.unknown, ...unknown] };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const GATE_WAIT_MS = Number(process.env.FACTORY_GATE_WAIT_MS ?? "60000");
const sessionUrl = () => (mySession() ? `https://claude.ai/code/${mySession()}` : null);

/** 書き込み権限のある人の factory:review（古い順）。reviews の API から読む */
async function loadReviewMarks(n: number, withAudit = false): Promise<GateReview[]> {
  const marks = (await getAll<{ body: string | null; submitted_at: string; author_association: string }>(`/repos/${REPO}/pulls/${n}/reviews`))
    .sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1))
    .filter((r) => TRUSTED_ASSOCIATIONS.includes(r.author_association))
    .map((r) => parseReviewMark(r.body ?? ""))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  // withAudit: ゲートの監査（factory:gate-review）の changes も、直すものに入れる（fix）
  return marks.filter((m) => withAudit || m.kind === "review").map((m) => ({ verdict: m.verdict, commit: m.commit }));
}

async function loadImplementGate(n: number): Promise<GateInput> {
  const { status, data: issue } = await get<RawIssue>(`/repos/${REPO}/issues/${n}`);
  const labels = status === 404 ? [] : (issue.labels ?? []).map((l) => normalizeLabel(l.name));
  const events = await getAll<{ event: string; created_at: string; label?: { name: string }; actor?: { login: string } }>(`/repos/${REPO}/issues/${n}/events`);
  const last = events.filter((e) => e.event === "labeled" && START_LABELS.includes(normalizeLabel(e.label?.name ?? ""))).at(-1);
  const comments = (await getAll<RawTrustedComment & { created_at: string }>(`/repos/${REPO}/issues/${n}/comments`))
    .filter((c) => TRUSTED_ASSOCIATIONS.includes(c.author_association))
    .map((c): Comment => ({ body: c.body ?? "", createdAt: c.created_at, author: c.user?.login }));
  const closes = new RegExp(`\\bcloses\\s+#${n}\\b`, "i");
  const prs = (await getAll<{ number: number; body: string | null; draft: boolean; head: { ref: string; repo: { full_name: string } | null } }>(`/repos/${REPO}/pulls?state=open`)).filter((p) => closes.test(p.body ?? ""));
  const closingPrs = await Promise.all(
    prs.map(async (p) => {
      const issueComments = await getAll<RawTrustedComment>(`/repos/${REPO}/issues/${p.number}/comments`);
      const reviewed = (await loadReviewMarks(p.number)).length > 0 || issueComments.some((c) => TRUSTED_ASSOCIATIONS.includes(c.author_association) && /<!--\s*factory:review\b/.test(c.body ?? ""));
      return { number: p.number, headRef: p.head.ref, headRepo: p.head.repo?.full_name ?? null, draft: p.draft, reviewed };
    }),
  );
  const branchExists = (await get<unknown>(`/repos/${REPO}/branches/${encodeURIComponent(`claude/issue-${n}`)}`)).status === 200; // 読めない（404 以外の失敗）ときは無いものとして lock に進む。鍵は create_branch の成否で決まる
  return {
    role: "implement", number: n, sessionUrl: sessionUrl(), repo: REPO, issueOpen: status !== 404 && issue.state === "open", labels,
    lastStartAt: last?.created_at ?? null, labeler: last?.actor?.login ?? null, comments, closingPrs, branchExists,
  };
}

async function loadPrGate(role: "review" | "fix", n: number): Promise<GateInput> {
  const read = async () => (await get<RawPull>(`/repos/${REPO}/pulls/${n}`)).data;
  const full = await read();
  const pr = {
    open: (full as RawPull & { state?: string }).state === "open",
    draft: full.draft,
    headRef: full.head?.ref ?? "",
    headSha: full.head?.sha ?? "",
    headRepo: full.head?.repo?.full_name ?? null,
    labels: (full.labels ?? []).map((l) => normalizeLabel(l.name)),
  };
  if (role === "fix") {
    // mergeable は、マージの直後は計算中（null）のことがある。直す対象になりうるときだけ、待って読み直す
    const eligible = pr.open && pr.draft && pr.headRef.startsWith("claude/issue-") && !pr.labels.includes(LABEL.needsHuman);
    const firstRead: (boolean | null)[] = [full.mergeable ?? null]; // 最初の読み取りは、取得済みの値を使う
    const mergeable = eligible ? await settleMergeable(async () => (firstRead.length > 0 ? firstRead.shift()! : ((await read()).mergeable ?? null)), () => sleep(GATE_WAIT_MS)) : true;
    return { role, number: n, sessionUrl: sessionUrl(), repo: REPO, pr, reviews: await loadReviewMarks(n, true), mergeable };
  }
  const reviews = await loadReviewMarks(n);
  const ok = reviews.filter((r) => r.verdict === "ok").at(-1);
  const afterOk = ok && !pr.headSha.startsWith(ok.commit) ? commitsAfter(n, ok.commit, pr.headSha) : null;
  const files = (await getAll<{ filename: string }>(`/repos/${REPO}/pulls/${n}/files`)).map((f) => f.filename);
  // 変更が監査で通すパスに当たるときだけ、ゲートの監査の判定に要る印・セッションを集める
  const audit = auditPaths(files).length > 0 ? (await loadGateContext(n, pr.headSha, full.body ?? "")).ctx : undefined;
  return { role, number: n, sessionUrl: sessionUrl(), repo: REPO, pr, reviews, afterOk, files, audit };
}

async function runGate(role: string | undefined, n: number) {
  if (role !== "implement" && role !== "review" && role !== "fix") throw new Error("--role implement・review・fix のどれかを指定する");
  if (!Number.isInteger(n)) throw new Error("--number に Issue か PR の番号を指定する");
  if (role !== "implement") return gateDecision(await loadPrGate(role, n));
  const first = gateDecision(await loadImplementGate(n));
  // 鍵（ブランチ）だけがあり PR が無いときは、別のセッションが鍵を作ってから着手のコメントを書くまでのすき間を待って、読み直す
  if (first.decision === "takeover" && first.pr === null) {
    await sleep(GATE_WAIT_MS);
    return gateDecision(await loadImplementGate(n));
  }
  return first;
}

/** merge-check・review-status に共通のレビューの判定（人の merge-check と自動の判定が食い違わないよう、1 か所にする） */
async function reviewCheck(n: number, headSha: string): Promise<ReturnType<typeof mergeCheck>> {
  const reviews = (await getAll<{ body: string | null; submitted_at: string; author_association: string }>(`/repos/${REPO}/pulls/${n}/reviews`))
    .sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1))
    .map((r) => ({ body: r.body ?? "", association: r.author_association }));
  const commitOf = /<!--\s*factory:review\s+verdict=\w+[^>]*?commit=([0-9a-f]+)/;
  const last = reviews
    .filter((r) => TRUSTED_ASSOCIATIONS.includes(r.association))
    .map((r) => commitOf.exec(r.body)?.[1])
    .filter(Boolean)
    .at(-1);
  return mergeCheck({ reviews, headSha, after: last ? commitsAfter(n, last, headSha) : [] });
}

async function main(): Promise<unknown> {
  const [cmd, num] = process.argv.slice(2);
  const n = Number(num);
  switch (cmd) {
    case "precheck": {
      if (!Number.isInteger(n)) throw new Error("Issue の番号を指定する");
      const files = splitFiles(arg("files")).filter((f) => !f.startsWith("tests/"));
      const [self, inProgress, queued, openPrs, own] = await Promise.all([loadIssue(n), loadInProgress(), loadWaiting(), loadOpenPrs(), ownPr(n)]);
      await loadOpen(dependencies(self));
      const d = precheck({ self, files, inProgress, queued, openPrs, isOpen, isStalled, ownPr: own, mainBroken: await loadMainBroken() });
      return { issue: n, files, ...d, actions: precheckActions(self, files, d) };
    }
    case "pick": {
      const [queued, inProgress, openPrs, b] = await Promise.all([loadWaiting(), loadInProgress(), loadOpenPrs(), loadBudget()]);
      await loadOpen(queued.flatMap(dependencies));
      const inProgressCount = inProgress.length;
      return { inProgress: inProgressCount, ...b, ...pick({ queued, inProgressCount, isOpen, isStalled, openPrs, inProgress, readyRemaining: b.remaining, mainBroken: await loadMainBroken() }) };
    }
    case "budget":
      return loadBudget();
    case "merge-check": {
      if (!Number.isInteger(n)) throw new Error("PR の番号を指定する");
      const pr = (await get<{ head: { sha: string } }>(`/repos/${REPO}/pulls/${n}`)).data;
      const review = await reviewCheck(n, pr.head.sha);
      if (!review.ok) return { pr: n, ...review };
      // レビューが ok でも、キューに入る条件のチェックが落ちていればキューに入らない（#364）
      const runs = (
        await get<{ check_runs: { name: string; status: string; conclusion: string | null; started_at: string }[] }>(`/repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=100`)
      ).data.check_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, startedAt: r.started_at }));
      const ci = ciCheck(runs);
      return { pr: n, ...review, ...(ci.ok ? {} : { ok: false, reason: ci.reason }) };
    }
    case "gate":
      return runGate(arg("role"), Number(arg("number")));
    case "review-status": {
      if (!Number.isInteger(n)) throw new Error("PR の番号を指定する");
      const pr = (await get<{ head: { sha: string }; labels: { name: string }[] }>(`/repos/${REPO}/pulls/${n}`)).data;
      const review = await reviewCheck(n, pr.head.sha);
      const raw = await getAll<{ filename: string; previous_filename?: string }>(`/repos/${REPO}/pulls/${n}/files`);
      // 一覧が途中で切れた・判定の間に head が変わったときは、付けない（安全側に倒す）
      const now = (await get<{ head: { sha: string }; changed_files: number }>(`/repos/${REPO}/pulls/${n}`)).data;
      if (now.head.sha !== pr.head.sha) return { pr: n, sha: pr.head.sha, state: null, description: "判定の間に PR の最新のコミットが変わった。次のきっかけで判定し直す。" };
      if (raw.length !== now.changed_files) return { pr: n, sha: pr.head.sha, state: null, description: `変更ファイルの一覧（${raw.length} 件）が PR の変更ファイル数（${now.changed_files} 件）と合わない。人が確かめる。` };
      // 判定のよりどころは GitHub の変更ファイル（PR の側の記述は読まない）
      const files = raw.flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]);
      // 変更が監査で通すパスに当たり、1 回目のレビューが ok のときだけ、監査の印を集める（それ以外は集めない）
      const gate = review.ok && auditPaths(files).length > 0 ? (await loadGateContext(n, pr.head.sha, (await get<{ body: string | null }>(`/repos/${REPO}/pulls/${n}`)).data.body ?? "")).ctx : undefined;
      return { pr: n, sha: pr.head.sha, ...reviewStatus(review, pr.head.sha, pr.labels.map((l) => l.name), files, gate) };
    }
    case "stalled": {
      const role = arg("role");
      if (role !== "dispatch" && role !== "patrol") throw new Error("--role dispatch か --role patrol を指定する");
      return loadStalled(role);
    }
    case "relabel": {
      const minutes = Number(arg("minutes") ?? "15");
      const [inProgress, b] = await Promise.all([loadInProgress(), loadBudget()]);
      const issues = await Promise.all(
        inProgress.map(async (i) => {
          const events = await getAll<{ event: string; created_at: string; label?: { name: string } }>(`/repos/${REPO}/issues/${i.number}/events`);
          const last = events.filter((e) => e.event === "labeled" && START_LABELS.includes(normalizeLabel(e.label?.name ?? ""))).pop();
          return { number: i.number, label: normalizeLabel(last?.label?.name ?? LABEL.inProgress), labeledAt: last?.created_at ?? "", comments: i.comments, hasPr: (await ownPr(i.number)) !== null };
        }),
      );
      const r = relabelTargets({ issues: issues.filter((i) => i.labeledAt), now: new Date().toISOString(), minMinutes: minutes, remaining: b.remaining });
      return { ...b, minutes, ...r };
    }
    case "handled": {
      const since = arg("since");
      if (!since) throw new Error("--since <ISO 8601> を指定する");
      const raw = await getAll<RawComment>(`/repos/${REPO}/issues/comments?since=${encodeURIComponent(since)}`);
      const comments = raw.map((c) => ({ issue: Number(c.issue_url.split("/").pop()), body: c.body ?? "", createdAt: c.created_at }));
      return { since, mySession: mySession(), handled: handledByOthers({ comments, since, mySession: mySession() }) };
    }
    default:
      throw new Error("pick / precheck / relabel / stalled / gate / handled / budget / merge-check / review-status のどれかを指定する");
  }
}

main().then(
  (r) => {
    const res = r as { decision?: string; reason?: string; actions?: unknown };
    if (res.decision === "error" && !res.actions) res.actions = errorActions(res.reason ?? "");
    console.log(JSON.stringify(r, null, 2));
    // decision が error（記録が無いなど）のときも、例外のときと同じ終了コード 2 にそろえる
    if ((r as { decision?: string }).decision === "error") process.exit(2);
  },
  (e: unknown) => {
    console.log(JSON.stringify({ decision: "error", reason: e instanceof Error ? e.message : String(e) }, null, 2));
    process.exit(2);
  },
);
