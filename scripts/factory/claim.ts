// Factory の Routine が使う判定のスクリプト（GitHub を読むだけ。書き込みはしない）。
// 使い方（結果は JSON で標準出力に出る。役は decision に従い、ラベルとコメントを GitHub MCP で変える）:
//   node scripts/factory/claim.ts precheck <Issue> --files a.ts,b.ts   着手の前の確かめ
//   node scripts/factory/claim.ts confirm <Issue> [--wait 30]           着手して 30 秒後の読み直し
//   node scripts/factory/claim.ts pick                                  キューから取り出してよい Issue
//   node scripts/factory/claim.ts handled --since <ISO 8601>            ほかの割り当てがもう処理した Issue・PR
// Node 22.18 以上（型を外して .ts をそのまま動かす）。クラウドのプロキシを通すため、NODE_USE_ENV_PROXY=1 で自分を起動し直す。
import { spawnSync } from "node:child_process";
import {
  confirm,
  dependencies,
  handledByOthers,
  pick,
  precheck,
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

type RawIssue = { number: number; body: string | null; state: string; pull_request?: unknown };
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
async function loadOpen(numbers: number[]): Promise<void> {
  for (const n of numbers) {
    if (openCache.has(n)) continue;
    const { status, data } = await get<RawIssue>(`/repos/${REPO}/issues/${n}`);
    openCache.set(n, status !== 404 && (data as RawIssue).state === "open");
  }
}
const isOpen = (n: number) => openCache.get(n) ?? false;

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

async function loadLabeled(label: string): Promise<IssueInfo[]> {
  const raws = (await getAll<RawIssue>(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(label)}`)).filter((i) => !i.pull_request);
  return Promise.all(raws.map((r) => loadIssue(r.number, r)));
}

async function loadOpenPrs(): Promise<PrInfo[]> {
  const prs = await getAll<{ number: number; head: { ref: string } }>(`/repos/${REPO}/pulls?state=open`);
  const mine = prs.filter((p) => p.head.ref.startsWith("claude/"));
  return Promise.all(
    mine.map(async (p) => ({
      number: p.number,
      headRef: p.head.ref,
      files: (await getAll<{ filename: string }>(`/repos/${REPO}/pulls/${p.number}/files`)).map((f) => f.filename),
    })),
  );
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
      const [self, inProgress, queued, openPrs] = await Promise.all([loadIssue(n), loadLabeled("in-progress"), loadLabeled("queued"), loadOpenPrs()]);
      await loadOpen(dependencies(self));
      return { issue: n, files, ...precheck({ self, files, inProgress, queued, openPrs, isOpen }) };
    }
    case "confirm": {
      if (!Number.isInteger(n)) throw new Error("Issue の番号を指定する");
      const wait = Number(arg("wait") ?? "30");
      await new Promise((r) => setTimeout(r, wait * 1000));
      const [self, inProgress] = await Promise.all([loadIssue(n), loadLabeled("in-progress")]);
      return { issue: n, ...confirm({ self, inProgress }) };
    }
    case "pick": {
      const [queued, inProgress] = await Promise.all([loadLabeled("queued"), getAll<RawIssue>(`/repos/${REPO}/issues?state=open&labels=in-progress`)]);
      await loadOpen(queued.flatMap(dependencies));
      const inProgressCount = inProgress.filter((i) => !i.pull_request).length;
      return { inProgress: inProgressCount, ...pick({ queued, inProgressCount, isOpen }) };
    }
    case "handled": {
      const since = arg("since");
      if (!since) throw new Error("--since <ISO 8601> を指定する");
      const raw = await getAll<RawComment>(`/repos/${REPO}/issues/comments?since=${encodeURIComponent(since)}`);
      const comments = raw.map((c) => ({ issue: Number(c.issue_url.split("/").pop()), body: c.body ?? "", createdAt: c.created_at }));
      return { since, mySession: mySession(), handled: handledByOthers({ comments, since, mySession: mySession() }) };
    }
    default:
      throw new Error("precheck / confirm / pick / handled のどれかを指定する");
  }
}

main().then(
  (r) => console.log(JSON.stringify(r, null, 2)),
  (e: unknown) => {
    console.log(JSON.stringify({ decision: "error", reason: e instanceof Error ? e.message : String(e) }, null, 2));
    process.exit(2);
  },
);
