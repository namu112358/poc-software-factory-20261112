// PR のレビューの印（factory:review）の読み取り（stalled・gate が使う）。

import type { GateReview } from "../core/gate.ts";
import { TRUSTED_ASSOCIATIONS } from "../core/repo.ts";
import { REPO, getAll } from "./github.ts";

export const COMMIT_MARK_RE = /<!--\s*factory:review\s+verdict=(\w+)[^>]*?commit=([0-9a-f]+)/;

/** 書き込み権限のある人の factory:review（古い順）。reviews の API から読む */
export async function loadReviewMarks(n: number): Promise<GateReview[]> {
  return (await getAll<{ body: string | null; submitted_at: string; author_association: string }>(`/repos/${REPO}/pulls/${n}/reviews`))
    .sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1))
    .filter((r) => TRUSTED_ASSOCIATIONS.includes(r.author_association))
    .map((r) => COMMIT_MARK_RE.exec(r.body ?? ""))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ verdict: m[1], commit: m[2] }));
}
