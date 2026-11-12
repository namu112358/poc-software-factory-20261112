// Factory の Routine が使う判定のスクリプト（GitHub を読むだけ。書き込みはしない）。
// 使い方（結果は JSON で標準出力に出る。役は decision に従い、ラベルとコメントを GitHub MCP で変える）:
//   node scripts/factory/claim.ts pick                                  待っている Issue（ready あり・in-progress なし）のうち、着手させる候補
//   node scripts/factory/claim.ts precheck <Issue> --files a.ts,b.ts   候補 1 件を着手させてよいかの確かめ（actions に、そのまま行う操作）
//   node scripts/factory/claim.ts relabel --minutes 15                  起動しなかった実装の付け直しの対象（付け直す数は budget の残りまで）
//   node scripts/factory/claim.ts handled --since <ISO 8601>            ほかの割り当てがもう処理した Issue・PR
//   node scripts/factory/claim.ts budget                                直近 60 分に in-progress を付けた回数と、あと何回付けてよいか
// Node 22.18 以上（型を外して .ts をそのまま動かす）。クラウドのプロキシを通すため、NODE_USE_ENV_PROXY=1 で自分を起動し直す。
import { spawnSync } from "node:child_process";
import {
  dependencies,
  handledByOthers,
  makeIsStalled,
  pick,
  STALLED_LABELS,
  errorActions,
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
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/vnd.github+json" } });
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
/** Issue か PR（番号）が needs-human・blocked:question で人を待っているか（#255） */
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
  };
}

/** 実装の開始の合図（実装の Routine のトリガー）。標準と難しい用 */
const START_LABELS = ["in-progress", "in-progress:hard"];
/** 待っている Issue から外すラベル（作業中・人を待っている・実装しない） */
const NOT_WAITING_LABELS = [...START_LABELS, "needs-human", "blocked:question", "epic"];

async function loadLabeled(label: string): Promise<IssueInfo[]> {
  const raws = (await getAll<RawIssue>(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(label)}`)).filter((i) => !i.pull_request);
  return Promise.all(raws.map((r) => loadIssue(r.number, r)));
}

/** 作業中の Issue: in-progress か in-progress:hard が付いた開いている Issue */
async function loadInProgress(): Promise<IssueInfo[]> {
  const lists = await Promise.all(START_LABELS.map(loadLabeled));
  const byNumber = new Map(lists.flat().map((i) => [i.number, i]));
  return [...byNumber.values()];
}

/** 待っている Issue: ready があり、作業中・人待ち・Epic のラベルが無い開いている Issue */
async function loadWaiting(): Promise<IssueInfo[]> {
  const raws = (await getAll<RawIssue>(`/repos/${REPO}/issues?state=open&labels=ready`)).filter(
    (i) => !i.pull_request && !(i.labels ?? []).some((l) => NOT_WAITING_LABELS.includes(l.name)),
  );
  return Promise.all(raws.map((r) => loadIssue(r.number, r)));
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

/** 直近 60 分に in-progress / in-progress:hard が付いた回数（実装の Routine の起動のきっかけ。#250） */
async function loadBudget() {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let count = 0;
  for (let page = 1; page <= 10; page++) {
    const { data } = await get<{ event: string; created_at: string; label?: { name: string } }[]>(`/repos/${REPO}/issues/events?per_page=100&page=${page}`);
    for (const e of data) {
      if (e.created_at > since && e.event === "labeled" && START_LABELS.includes(e.label?.name ?? "")) count++;
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

async function main(): Promise<unknown> {
  const [cmd, num] = process.argv.slice(2);
  const n = Number(num);
  switch (cmd) {
    case "precheck": {
      if (!Number.isInteger(n)) throw new Error("Issue の番号を指定する");
      const files = splitFiles(arg("files")).filter((f) => !f.startsWith("tests/"));
      const [self, inProgress, queued, openPrs, own] = await Promise.all([loadIssue(n), loadInProgress(), loadWaiting(), loadOpenPrs(), ownPr(n)]);
      await loadOpen(dependencies(self));
      const d = precheck({ self, files, inProgress, queued, openPrs, isOpen, isStalled, ownPr: own });
      return { issue: n, files, ...d, actions: precheckActions(self, files, d) };
    }
    case "pick": {
      const [queued, inProgress, openPrs, b] = await Promise.all([loadWaiting(), loadInProgress(), loadOpenPrs(), loadBudget()]);
      await loadOpen(queued.flatMap(dependencies));
      const inProgressCount = inProgress.length;
      return { inProgress: inProgressCount, ...b, ...pick({ queued, inProgressCount, isOpen, isStalled, openPrs, inProgress, readyRemaining: b.remaining }) };
    }
    case "budget":
      return loadBudget();
    case "relabel": {
      const minutes = Number(arg("minutes") ?? "15");
      const [inProgress, b] = await Promise.all([loadInProgress(), loadBudget()]);
      const issues = await Promise.all(
        inProgress.map(async (i) => {
          const events = await getAll<{ event: string; created_at: string; label?: { name: string } }>(`/repos/${REPO}/issues/${i.number}/events`);
          const last = events.filter((e) => e.event === "labeled" && START_LABELS.includes(e.label?.name ?? "")).pop();
          return { number: i.number, label: last?.label?.name ?? "in-progress", labeledAt: last?.created_at ?? "", comments: i.comments, hasPr: (await ownPr(i.number)) !== null };
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
      throw new Error("pick / precheck / relabel / handled / budget のどれかを指定する");
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
