// Factory の Routine が使う判定のスクリプト（GitHub を読むだけ。書き込みはしない）。
// 使い方（結果は JSON で標準出力に出る。役は decision に従い、ラベルとコメントを GitHub MCP で変える）:
//   node scripts/factory/claim.ts pick                                  待っている Issue（status:ready あり・status:in-progress なし）のうち、着手させる候補
//   node scripts/factory/claim.ts precheck <Issue> --files a.ts,b.ts   候補 1 件を着手させてよいかの確かめ（actions に、そのまま行う操作）
//   node scripts/factory/claim.ts relabel --minutes 15                  起動しなかった実装の付け直しの対象（付け直す数は budget の残りまで）
//   node scripts/factory/claim.ts handled --since <ISO 8601>            ほかの割り当てがもう処理した Issue・PR
//   node scripts/factory/claim.ts merge-check <PR>                      merge:requested のラベルを付けてよいか（最新のレビューが ok で、その後は取り込みだけか）
//   node scripts/factory/claim.ts review-status <PR>                    レビューを通ったことを表す status（factory-review）の値（success・failure・null）。GitHub Actions が使う
//   node scripts/factory/claim.ts budget                                直近 60 分に status:in-progress を付けた回数と、あと何回付けてよいか
// Node 22.18 以上（型を外して .ts をそのまま動かす）。クラウドのプロキシを通すため、NODE_USE_ENV_PROXY=1 で自分を起動し直す。
import { spawnSync } from "node:child_process";
import {
  dependencies,
  handledByOthers,
  makeIsStalled,
  pick,
  STALLED_LABELS,
  START_LABELS,
  LABEL,
  normalizeLabel,
  errorActions,
  mergeCheck,
  reviewStatus,
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

/** merge-check・review-status に共通: 最新のレビューが ok で、その後は取り込みだけのコミットかを判定する */
async function reviewCheck(n: number): Promise<{ headSha: string; labels: string[]; review: ReturnType<typeof mergeCheck> }> {
  const pr = (await get<{ head: { sha: string }; labels: { name: string }[] }>(`/repos/${REPO}/pulls/${n}`)).data;
  const reviews = (await getAll<{ body: string | null; submitted_at: string; author_association: string }>(`/repos/${REPO}/pulls/${n}/reviews`))
    .sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1))
    .map((r) => ({ body: r.body ?? "", association: r.author_association }));
  const git = (...a: string[]) => spawnSync("git", a, { encoding: "utf-8" });
  const commitOf = /<!--\s*factory:review\s+verdict=\w+[^>]*?commit=([0-9a-f]+)/;
  const last = reviews
    .filter((r) => TRUSTED_ASSOCIATIONS.includes(r.association))
    .map((r) => commitOf.exec(r.body)?.[1])
    .filter(Boolean)
    .at(-1);
  let after: { sha: string; mergeOnly: boolean }[] | null = [];
  if (last && !pr.head.sha.startsWith(last)) {
    const fetched = git("fetch", "-q", "origin", `+pull/${n}/head:refs/factory/pr-${n}`, "+main:refs/factory/main");
    if (fetched.status !== 0) throw new Error(`git fetch に失敗した（${fetched.stderr.trim()}）。付けずに、後でやり直す。`);
    // 手元の参照が古いまま判定しないよう、取り込んだ PR の先頭が GitHub の head と同じかを確かめる
    const local = git("rev-parse", `refs/factory/pr-${n}`).stdout.trim();
    if (local !== pr.head.sha) throw new Error(`手元の PR の先頭（${local.slice(0, 7)}）が GitHub の head（${pr.head.sha.slice(0, 7)}）と違う。付けずに、後でやり直す。`);
    const list = git("rev-list", "--first-parent", `${last}..refs/factory/pr-${n}`);
    if (list.status !== 0) after = null;
    else
      after = list.stdout.split("\n").filter(Boolean).map((sha) => {
        const parents = git("rev-list", "--parents", "-n1", sha).stdout.trim().split(" ").slice(1);
        const diff = git("show", "--format=", "--remerge-diff", sha).stdout.trim();
        // 取り込みだけのコミット: main を取り込んだ（2 つ目の親が main に含まれる）マージで、--remerge-diff の差分が空
        const fromMain = parents.length === 2 && git("merge-base", "--is-ancestor", parents[1], "refs/factory/main").status === 0;
        return { sha, mergeOnly: fromMain && diff === "" };
      });
  }
  return { headSha: pr.head.sha, labels: pr.labels.map((l) => l.name), review: mergeCheck({ reviews, headSha: pr.head.sha, after }) };
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
      const { headSha, review } = await reviewCheck(n);
      const pr = { head: { sha: headSha } };
      if (!review.ok) return { pr: n, ...review };
      // レビューが ok でも、キューに入る条件のチェックが落ちていればキューに入らない（#364）
      const runs = (
        await get<{ check_runs: { name: string; status: string; conclusion: string | null; started_at: string }[] }>(`/repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=100`)
      ).data.check_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, startedAt: r.started_at }));
      const ci = ciCheck(runs);
      return { pr: n, ...review, ...(ci.ok ? {} : { ok: false, reason: ci.reason }) };
    }
    case "review-status": {
      if (!Number.isInteger(n)) throw new Error("PR の番号を指定する");
      const { headSha, labels, review } = await reviewCheck(n);
      return { pr: n, sha: headSha, ...reviewStatus(review, headSha, labels) };
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
      throw new Error("pick / precheck / relabel / handled / budget / merge-check / review-status のどれかを指定する");
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
