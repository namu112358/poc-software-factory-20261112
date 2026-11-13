// `claim.ts gate --role implement|review|fix --number <N>`: 実装・レビュー・修正が起動してよいか（decision と、役が行う ops）。

import { gateDecision, settleMergeable, type GateInput } from "../core/gate.ts";
import { LABEL, START_LABELS, normalizeLabel } from "../core/labels.ts";
import type { Comment } from "../core/queue.ts";
import { TRUSTED_ASSOCIATIONS } from "../core/repo.ts";
import { commitsAfter } from "./commits-after.ts";
import { REPO, get, getAll, sessionUrl, sleep, type RawIssue, type RawPull, type RawTrustedComment } from "./github.ts";
import { loadReviewMarks } from "./review-marks.ts";

const GATE_WAIT_MS = Number(process.env.FACTORY_GATE_WAIT_MS ?? "60000");

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
    return { role, number: n, sessionUrl: sessionUrl(), repo: REPO, pr, reviews: await loadReviewMarks(n), mergeable };
  }
  const reviews = await loadReviewMarks(n);
  const ok = reviews.filter((r) => r.verdict === "ok").at(-1);
  const afterOk = ok && !pr.headSha.startsWith(ok.commit) ? commitsAfter(n, ok.commit, pr.headSha) : null;
  const files = (await getAll<{ filename: string }>(`/repos/${REPO}/pulls/${n}/files`)).map((f) => f.filename);
  return { role, number: n, sessionUrl: sessionUrl(), repo: REPO, pr, reviews, afterOk, files };
}

export async function runGate(role: string | undefined, n: number) {
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
