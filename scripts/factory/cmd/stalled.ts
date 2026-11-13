// `claim.ts stalled --role dispatch|patrol`: 止まった実装・PR の片付け（actions に、そのまま行う操作。unknown は 1 分後にもう一度）。

import { CI_CHECKS, combineChecks, type CheckState } from "../core/checks.ts";
import { START_LABELS, normalizeLabel } from "../core/labels.ts";
import { TRUSTED_ASSOCIATIONS, isOwnClaudePr } from "../core/repo.ts";
import { stalledActions, stalledLoadPlan, type StalledIssue, type StalledPr } from "../core/stalled.ts";
import { commitsAfter } from "./commits-after.ts";
import { REPO, get, getAll, issueOf, mySession, type RawIssue, type RawPull, type RawTrustedComment } from "./github.ts";
import { COMMIT_MARK_RE } from "./review-marks.ts";

/** 止まった実装・PR の判定の入力を GitHub と git から集める（読むだけ） */
async function loadStalled(role: string) {
  const list = (await getAll<RawPull>(`/repos/${REPO}/pulls?state=open`)).filter((p) => isOwnClaudePr(p, REPO));
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
    try {
      if (mergeable !== null) {
        const comments = (await getAll<RawTrustedComment>(`/repos/${REPO}/issues/${n}/comments`)).filter((c) => TRUSTED_ASSOCIATIONS.includes(c.author_association));
        priorMarks = comments
          .map((c) => /factory:(?:dispatch|patrol) action=([\w-]+) commit=([0-9a-f]+)/.exec(c.body ?? ""))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => ({ action: m[1], commit: m[2] }));
      }
      const plan = stalledLoadPlan({ own, mergeable, draft: full.draft });
      if (plan.reviews) {
        reviews = (await getAll<{ body: string | null; submitted_at: string; author_association: string }>(`/repos/${REPO}/pulls/${n}/reviews`))
          .sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1))
          .filter((r) => TRUSTED_ASSOCIATIONS.includes(r.author_association))
          .map((r) => COMMIT_MARK_RE.exec(r.body ?? ""))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => ({ verdict: m[1], commit: m[2] }));
        for (const commit of new Set([reviews.at(-1)?.commit, reviews.filter((r) => r.verdict === "ok").at(-1)?.commit])) {
          if (commit) after[commit] = commitsAfter(n, commit, full.head.sha);
        }
      }
      if (plan.readyAt) {
        const tl = await getAll<{ event: string; created_at: string }>(`/repos/${REPO}/issues/${n}/timeline`);
        readyAt = tl.filter((e) => e.event === "ready_for_review").at(-1)?.created_at ?? full.created_at;
      }
      if (plan.checks) {
        const checkState = async (name: string): Promise<CheckState> => {
          const runs = (await get<{ check_runs: { status: string; conclusion: string | null; started_at: string }[] }>(`/repos/${REPO}/commits/${full.head.sha}/check-runs?check_name=${name}&per_page=100`)).data.check_runs ?? [];
          const latest = runs.sort((a, b) => (a.started_at < b.started_at ? -1 : 1)).at(-1);
          return !latest ? "none" : latest.status !== "completed" ? "pending" : latest.conclusion === "success" ? "success" : "failure";
        };
        appCheck = combineChecks(await Promise.all(CI_CHECKS.map((name) => checkState(name))));
        bodyCheck = await checkState("pr-body-check");
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
    prs.push({ number: n, headRef: full.head.ref, headSha: full.head.sha, draft: full.draft, mergeable, labels, updatedAt: full.updated_at, readyAt, appCheck, reviews, after, priorMarks, bodyCheck, mergifyTimeout });
  }
  const closed = (await get<(RawIssue & { updated_at: string })[]>(`/repos/${REPO}/issues?state=closed&per_page=100&sort=updated&direction=desc`)).data.filter((i) => !i.pull_request);
  const closedStarted = closed.map((i) => ({ number: i.number, labels: (i.labels ?? []).map((l) => normalizeLabel(l.name)) })).filter((i) => i.labels.some((l) => START_LABELS.includes(l)));
  const sessionId = mySession();
  const r = stalledActions({ role, now: new Date().toISOString(), sessionUrl: sessionId ? `https://claude.ai/code/${sessionId}` : null, prs, issues: [...issues.values()], closedStarted });
  return { ...r, unknown: [...r.unknown, ...unknown] };
}

export async function runStalled(role: string | undefined) {
  if (role !== "dispatch" && role !== "patrol") throw new Error("--role dispatch か --role patrol を指定する");
  return loadStalled(role);
}
