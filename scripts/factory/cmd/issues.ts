// Issue の読み取り（pick・precheck・relabel が使う）。

import { LABEL, START_LABELS, STALLED_LABELS, normalizeLabel } from "../core/labels.ts";
import type { Comment, IssueInfo } from "../core/queue.ts";
import { REPO, getAll, get, type RawComment, type RawIssue } from "./github.ts";

export async function loadIssue(n: number, raw?: RawIssue): Promise<IssueInfo> {
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
export async function loadInProgress(): Promise<IssueInfo[]> {
  const lists = await Promise.all(START_LABELS.map(loadLabeled));
  const byNumber = new Map(lists.flat().map((i) => [i.number, i]));
  return [...byNumber.values()];
}

/** 待っている Issue: status:ready があり、作業中・人待ち・Epic・kaizen のラベルが無い開いている Issue */
export async function loadWaiting(): Promise<IssueInfo[]> {
  const raws = (await getAll<RawIssue>(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL.ready)}`)).filter(
    (i) => !i.pull_request && !(i.labels ?? []).some((l) => NOT_WAITING_LABELS.includes(l.name)),
  );
  return Promise.all(raws.map((r) => loadIssue(r.number, r)));
}
