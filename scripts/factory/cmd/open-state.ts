// 番号（Issue か PR）が開いているか・人を待っているかの読み取りと、その覚え（pick・precheck が使う）。

import { makeIsStalled } from "../core/queue.ts";
import { REPO, get, issueOf, type RawIssue } from "./github.ts";

const openCache = new Map<number, boolean>();
const labelCache = new Map<number, string[]>();
const prIssueCache = new Map<number, number>(); // PR の番号 → その Issue（claude/issue-<番号>）の番号

export async function loadOpen(numbers: number[]): Promise<void> {
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
export const isOpen = (n: number) => openCache.get(n) ?? false;
/** Issue か PR（番号）が status:needs-human・status:blocked-question で人を待っているか（#255） */
export const isStalled = (n: number) => makeIsStalled(labelCache, prIssueCache)(n);
