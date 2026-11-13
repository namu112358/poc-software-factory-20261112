// merge-check・review-status に共通のレビューの判定（人の merge-check と自動の判定が食い違わないよう、1 か所にする）。

import { mergeCheck } from "../core/merge-check.ts";
import { TRUSTED_ASSOCIATIONS } from "../core/repo.ts";
import { commitsAfter } from "./commits-after.ts";
import { REPO, getAll } from "./github.ts";

export async function reviewCheck(n: number, headSha: string): Promise<ReturnType<typeof mergeCheck>> {
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
