// 各役の起動の判定（`claim.ts gate`。実装・レビュー・修正の手順書の「1.」）。GitHub と git は読まず、集めた入力だけで決める。

import { sameCommit, type StalledCommit } from "./commits.ts";
import { LABEL, START_LABELS, START_MARK_RE } from "./labels.ts";
import { stalledComment } from "./marks.ts";
import type { Comment } from "./queue.ts";
import { isOwnHead } from "./repo.ts";

/** 高リスクの変更ファイル（レビューで risk:high の目印にする） */
export const RISK_FILES: readonly string[] = ["src/lib/db/migrations.ts", "src/lib/auth.ts", "src/lib/session.ts", "src/lib/api.ts"];
const FIX_ROUND_LIMIT = 3;

export type GateReview = { verdict: string; commit: string }; // 書き込み権限のある人の factory:review（古い順）
/** headRepo: PR の head のリポジトリ（head.repo.full_name。フォークの PR は別の名前。消えていれば null） */
type GatePr = { open: boolean; draft: boolean; headRef: string; headSha: string; labels: string[]; headRepo: string | null };

export type GateInput =
  | {
      role: "implement";
      number: number;
      sessionUrl: string | null;
      repo: string; // このリポジトリ（owner/name）。フォークの PR を対象にしないために使う
      issueOpen: boolean;
      labels: string[]; // 今の名前に直したラベル
      /** 起動のラベルの最後の labeled。イベントが読めなければ null */
      lastStartAt: string | null; // 起動のラベルの最後の labeled の時刻。イベントが読めなければ null
      labeler: string | null; // 起動のラベルを付けた人（その labeled の actor の login）。読めなければ null
      comments: Comment[]; // 書き込み権限のある人のコメント
      closingPrs: { number: number; headRef: string; headRepo: string | null; draft: boolean; reviewed: boolean }[]; // Closes #N で参照する開いている PR
      branchExists: boolean; // claude/issue-<N> がある
    }
  | {
      role: "review";
      number: number;
      sessionUrl: string | null;
      repo: string; // このリポジトリ（owner/name）。フォークの PR を対象にしないために使う
      pr: GatePr;
      reviews: GateReview[];
      /** 最新の verdict=ok のコミットより後のコミット。履歴に無ければ null。ok が無ければ null */
      afterOk: StalledCommit[] | null;
      files: string[];
    }
  | {
      role: "fix";
      number: number;
      sessionUrl: string | null;
      repo: string; // このリポジトリ（owner/name）。フォークの PR を対象にしないために使う
      pr: GatePr;
      reviews: GateReview[];
      mergeable: boolean; // null は読み直した後に false（衝突）にしてから渡す
    };

export type GateResult = {
  role: string;
  number: number;
  decision: "stop" | "needs-human" | "takeover" | "lock" | "go";
  reason: string;
  pr: number | null;
  branch: string | null;
  labeler?: string | null; // implement のとき: 起動のラベルを付けた人。役が書き込み権限を確かめる
  ops: { removeLabels: string[]; addLabels: string[]; comment: string | null } | null;
  light?: boolean;
  riskFiles?: string[];
  fix?: { changes: boolean; conflict: boolean; removeMergeRequested: boolean } | null;
};

/** mergeable が null（計算中）なら wait してから読み直す。tries 回読んでも null なら衝突（false）として扱う */
export async function settleMergeable(read: () => Promise<boolean | null>, wait: () => Promise<void>, tries = 3): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (v !== null) return v;
    if (i < tries - 1) await wait();
  }
  return false;
}

/**
 * 実装・レビュー・修正が、起動してよいか（手順書の「1.」）の判定。GitHub と git は読まず、集めた入力だけで決める。
 * 表の行の順に、最初に当たった 1 つだけ。書き込み（ops）は返すだけで、役が行う。
 */
export function gateDecision(input: GateInput): GateResult {
  const base = { role: input.role, number: input.number };
  const stopBase = (reason: string): GateResult => ({ ...base, decision: "stop", reason, pr: null, branch: null, ops: null, ...(input.role === "fix" ? { fix: null } : {}) });
  const stop = stopBase;
  const note = (text: string, action: string) => stalledComment(input.role, action, text, input.sessionUrl);

  if (input.role === "implement") {
    const withLabeler = (r: GateResult): GateResult => ({ ...r, labeler: input.labeler });
    const stop = (reason: string) => withLabeler(stopBase(reason));
    const branch = `claude/issue-${input.number}`;
    const hasStart = input.labels.some((l) => START_LABELS.includes(l));
    if (!input.issueOpen) return stop("Issue が閉じている。");
    if (!hasStart) return stop("起動のラベルが付いていない。");
    const blocker = [LABEL.epic, LABEL.blockedQuestion, LABEL.needsHuman].find((l) => input.labels.includes(l));
    if (blocker) return stop(`${blocker} が付いている。`);
    if (input.comments.some((c) => START_MARK_RE.test(c.body) && c.createdAt > (input.lastStartAt ?? "")))
      return stop("起動のラベルが付いた後に、着手のコメントがもうある。");
    // フォークの PR は数えない（外の人が「Closes #N」の PR を出して、実装の着手を止められないように）
    const closing = input.closingPrs.filter((p) => isOwnHead(p.headRepo, input.repo));
    if (closing.length > 0) {
      const own = closing.find((p) => p.headRef === branch && p.draft && !p.reviewed);
      if (own) return withLabeler({ ...base, decision: "takeover", reason: `残った draft の PR #${own.number} がある（レビュー前）。引き継ぐ。`, pr: own.number, branch, ops: null });
      return stop(`この Issue を Closes で参照する開いている PR（#${closing[0].number}）がある。`);
    }
    if (input.branchExists) return withLabeler({ ...base, decision: "takeover", reason: `ブランチ ${branch} が残っている（PR は無い）。取り出して続ける。`, pr: null, branch, ops: null });
    return withLabeler({ ...base, decision: "lock", reason: `着手の鍵（ブランチ ${branch}）を作ってよい。`, pr: null, branch, ops: null });
  }

  const pr = input.pr;
  if (input.role === "review") {
    if (!pr.open) return stop("PR が閉じている。");
    if (pr.draft) return stop("PR が draft。");
    if (!isOwnHead(pr.headRepo, input.repo)) return stop("PR の head がこのリポジトリのブランチでない（フォークの PR）。");
    if (!pr.headRef.startsWith("claude/")) return stop("head のブランチが claude/ で始まらない。");
    if (pr.labels.includes(LABEL.needsHuman)) return stop("status:needs-human が付いている。");
    if (input.reviews.some((r) => sameCommit(r.commit, pr.headSha))) return stop("最新のコミットへのレビューがもうある。");
    const after = input.afterOk;
    if (after && after.length > 0 && after.every((c) => c.mergeOnly)) return stop("最新の ok のレビューの後は、取り込みだけのコミットだけ。");
    const light = after !== null && after.length > 0 && after.every((c) => c.merge === true);
    const riskFiles = input.files.filter((f) => RISK_FILES.includes(f));
    return {
      ...base,
      decision: "go",
      reason: light ? "ok の後が、マージのコミット（衝突の解消あり）だけ。軽い再レビュー。" : "レビューする。",
      pr: input.number,
      branch: null,
      ops: null,
      light,
      riskFiles,
    };
  }

  // fix
  if (!pr.open) return stop("PR が閉じている。");
  if (!pr.draft) return stop("PR が draft でない。");
  if (!isOwnHead(pr.headRepo, input.repo)) return stop("PR の head がこのリポジトリのブランチでない（フォークの PR）。");
  if (!pr.headRef.startsWith("claude/issue-")) return stop("head のブランチが claude/issue- で始まらない。");
  if (pr.labels.includes(LABEL.needsHuman)) return stop("status:needs-human が付いている。");
  const latest = input.reviews.at(-1);
  const changes = !!latest && latest.verdict === "changes" && sameCommit(latest.commit, pr.headSha);
  const conflict = !input.mergeable;
  if (!changes && !conflict) return stop("直すものが無い（最新のレビューの指摘は直してあり、衝突も無い）。");
  const rounds = input.reviews.filter((r) => r.verdict === "changes").length;
  if (rounds >= FIX_ROUND_LIMIT)
    return {
      ...base,
      decision: "needs-human",
      reason: `verdict=changes のレビューが ${rounds} 件ある。`,
      pr: input.number,
      branch: null,
      ops: { removeLabels: [], addLabels: [LABEL.needsHuman], comment: note("2 往復直しても指摘が残っているので、人に回す。", "round-limit") },
      fix: null,
    };
  return {
    ...base,
    decision: "go",
    reason: [changes ? "最新のレビューの指摘が未対応" : null, conflict ? "main と衝突している" : null].filter(Boolean).join("。") + "。",
    pr: input.number,
    branch: null,
    ops: null,
    fix: { changes, conflict, removeMergeRequested: pr.labels.includes(LABEL.merge) },
  };
}
