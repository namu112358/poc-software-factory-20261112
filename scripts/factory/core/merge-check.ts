// merge:requested を付けてよいかのレビューの判定（`claim.ts merge-check`。review-status も同じ判定を使う）。

import { TRUSTED_ASSOCIATIONS } from "./repo.ts";

/**
 * merge:requested を付けてよいか（#293）。最新の factory:review が verdict=ok で、そのレビューのコミットより後のコミットが
 * すべて「取り込みだけのコミット」（git show --remerge-diff の差分が空のマージ）なら ok。
 * reviews はレビュー（古い順）。印を信じるのは、書き込み権限のある人（TRUSTED_ASSOCIATIONS）のレビューだけ。
 * after は、レビューのコミットより後のコミット（first-parent）。
 */
export function mergeCheck(args: {
  reviews: { body: string; association: string }[];
  headSha: string;
  after: { sha: string; mergeOnly: boolean }[] | null; // null: レビューのコミットが PR の履歴に無い
}): { ok: boolean; reason: string; review: { verdict: string; commit: string } | null } {
  const marks = args.reviews
    .filter((r) => TRUSTED_ASSOCIATIONS.includes(r.association))
    .map((r) => r.body)
    .map((b) => /<!--\s*factory:review\s+verdict=(\w+)[^>]*?commit=([0-9a-f]+)/.exec(b))
    .filter((m): m is RegExpExecArray => m !== null);
  const last = marks.at(-1);
  if (!last) return { ok: false, reason: "factory:review のレビューが 1 つも無い。レビューの Routine を起こしてから（PR を draft にして Ready に戻す）付ける。", review: null };
  const review = { verdict: last[1], commit: last[2] };
  if (review.verdict !== "ok") return { ok: false, reason: `最新のレビューが verdict=${review.verdict}。直して ok になるまで付けない。`, review };
  // 同じ版に 2 つのレビューが付くことがある（Ready のイベントが重なったとき）。後の ok が、先の必須の指摘を打ち消さないようにする
  if (marks.some((m) => m[2] === review.commit && m[1] !== "ok"))
    return { ok: false, reason: `同じ版（${review.commit.slice(0, 7)}）に verdict=changes のレビューもある。指摘を直して、レビューを起こし直す。`, review };
  if (args.headSha.startsWith(review.commit) || review.commit.startsWith(args.headSha)) return { ok: true, reason: "最新のコミットが ok のレビューを受けている。", review };
  if (args.after === null) return { ok: false, reason: `レビューのコミット ${review.commit} が PR の履歴に見つからない。レビューを起こし直す。`, review };
  const changed = args.after.filter((c) => !c.mergeOnly).map((c) => c.sha.slice(0, 7));
  if (changed.length > 0) return { ok: false, reason: `ok のレビューの後に中身の変わるコミット（${changed.join("、")}）がある。レビューを起こし直す（PR を draft にして Ready に戻す）。`, review };
  return { ok: true, reason: "ok のレビューの後は、取り込みだけのコミットだけ。", review };
}
