// `claim.ts review-status <PR>`: レビューの結果の status の値（state: 自動でキューに入ってよいか〔factory-review〕、reviewed: 最新のコミットがレビューを通ったか〔factory-reviewed〕）。GitHub Actions が使う。

import { reviewStatus, reviewedStatus } from "../core/review-status.ts";
import { REPO, get, getAll } from "./github.ts";
import { reviewCheck } from "./review-check.ts";

export async function runReviewStatus(n: number) {
  if (!Number.isInteger(n)) throw new Error("PR の番号を指定する");
  const pr = (await get<{ head: { sha: string }; labels: { name: string }[] }>(`/repos/${REPO}/pulls/${n}`)).data;
  const review = await reviewCheck(n, pr.head.sha);
  const raw = await getAll<{ filename: string; previous_filename?: string }>(`/repos/${REPO}/pulls/${n}/files`);
  // 一覧が途中で切れた・判定の間に head が変わったときは、付けない（安全側に倒す）
  const now = (await get<{ head: { sha: string }; changed_files: number }>(`/repos/${REPO}/pulls/${n}`)).data;
  const none = { state: null, description: "判定の間に PR の最新のコミットが変わった。次のきっかけで判定し直す。" };
  if (now.head.sha !== pr.head.sha) return { pr: n, sha: pr.head.sha, ...none, reviewed: none };
  // factory-reviewed（レビューを通ったか）は、変更ファイルによらない
  const reviewed = reviewedStatus(review, pr.head.sha);
  if (raw.length !== now.changed_files) return { pr: n, sha: pr.head.sha, state: null, description: `変更ファイルの一覧（${raw.length} 件）が PR の変更ファイル数（${now.changed_files} 件）と合わない。人が確かめる。`, reviewed };
  // 判定のよりどころは GitHub の変更ファイル（PR の側の記述は読まない）
  const files = raw.flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]);
  return { pr: n, sha: pr.head.sha, ...reviewStatus(review, pr.head.sha, pr.labels.map((l) => l.name), files), reviewed };
}
