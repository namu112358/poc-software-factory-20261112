// 止まった実装・PR の片付けの判定（`claim.ts stalled`。割り当ての「3.」・巡回の「1.」）。GitHub には書かない。

import type { CheckState } from "./checks.ts";
import { sameCommit, type StalledCommit } from "./commits.ts";
import { LABEL, START_LABELS } from "./labels.ts";
import { stalledComment } from "./marks.ts";

export type StalledPr = {
  number: number;
  headRef: string;
  headSha: string;
  draft: boolean;
  mergeable: boolean | null;
  labels: string[]; // 今の名前に直したラベル
  updatedAt: string; // PR の updated_at
  readyAt: string | null; // 最後に Ready になった時刻（timeline の ready_for_review。無ければ PR を作った時刻）
  appCheck: CheckState; // 最新のコミットの CI（CI_CHECKS: app-check・design-system-check）の最新の実行を combineChecks でまとめたもの
  reviews: { verdict: string; commit: string }[]; // 書き込み権限のある人の factory:review（古い順）
  /** レビューのコミット → それより後のコミット（first-parent）。PR の履歴に無ければ null。head と同じなら [] */
  after: Record<string, StalledCommit[] | null>;
  priorMarks: { action: string; commit: string }[]; // 割り当て・巡回の `action=<処置> commit=<sha>` のコメント（書き込み権限のある人のもの）。同じ処置のくり返しを数える
  bodyCheck: CheckState; // 最新のコミットの pr-body-check の最新の実行
  mergifyTimeout: { at: string } | null; // Mergify の状況のコメントの dequeue_reason.code が CHECKS_TIMEOUT のとき、外れた時刻
};
export type StalledIssue = { number: number; labels: string[]; updatedAt: string };

export type StalledAction = {
  target: "pr" | "issue";
  number: number;
  action: string;
  removeLabels: string[];
  addLabels: string[];
  draft: null | "to-draft" | "to-ready" | "draft-then-ready" | "ready-then-draft";
  issue: null | { number: number; removeLabels: string[]; addLabels: string[] };
  comment: string | null;
};

const ISSUE_BRANCH_RE = /^claude\/issue-(\d+)$/;
const minutesSince = (at: string, now: string) => (new Date(now).getTime() - new Date(at).getTime()) / 60000;

/** 最新のコミットが、ok のレビューを受けているか、その後が取り込みだけのコミットだけか（merge-check の ok と同じ見方） */
function okCoversHead(pr: StalledPr): boolean {
  const ok = pr.reviews.filter((r) => r.verdict === "ok").at(-1);
  if (!ok) return false;
  if (sameCommit(pr.headSha, ok.commit)) return true;
  const after = pr.after[ok.commit];
  return after != null && after.every((c) => c.mergeOnly);
}

/** 最新のレビューより後に、取り込みだけでないコミットがあるか（レビューが無ければ true）。履歴に見つからなければ true */
function changedAfterLatestReview(pr: StalledPr): boolean {
  const last = pr.reviews.at(-1);
  if (!last) return true;
  if (sameCommit(pr.headSha, last.commit)) return false;
  const after = pr.after[last.commit];
  return after == null || after.some((c) => !c.mergeOnly);
}

/**
 * stalled の入力として、PR ごとに何を読むか（cmd/stalled.ts の loadStalled が使う）。
 * レビューと Ready の時刻は、claude/issue- 以外の PR でも読む（レビューの起こし直しは claude/ のすべての PR が対象。#559）。
 * Ready の時刻は Ready の PR だけ。CI・PR 本文の検査・Mergify の状況は、claude/issue- の PR で mergeable が分かっているときだけ（ほかの行で使う）。
 */
export function stalledLoadPlan(p: { own: boolean; mergeable: boolean | null; draft: boolean }): { reviews: boolean; readyAt: boolean; checks: boolean } {
  return { reviews: true, readyAt: !p.draft, checks: p.own && p.mergeable !== null };
}

/**
 * 止まった実装・PR の判定（dispatch.md・patrol.md の表を 1 つにしたもの）。GitHub には書かず、役が行う操作だけを返す。
 * 1 つの PR・Issue に当てはまる処置は、行の順（1〜9）で最初の 1 つだけ。mergeable が null の PR は unknown に入れ、ほかの行も判定しない。
 * 対象: claude/ の PR（claude/issue- 以外は「衝突」と「レビューが動かなかった」の行だけ。巡回は「レビューが動かなかった」だけ）。PR に status:needs-human、その Issue に blocked-question・needs-human・kind:epic があるものは対象外。
 * issues: 開いていて status:in-progress（-hard）が付いた Issue と、PR の Issue（PR の Issue は prs の headRef から引く）。
 * closedStarted: 閉じた Issue のうち、status:in-progress（-hard）が残っているもの（行 10）。
 */
export function stalledActions(input: {
  role: string;
  now: string;
  sessionUrl: string | null;
  prs: StalledPr[];
  issues: StalledIssue[];
  closedStarted: { number: number; labels: string[] }[];
}): { role: string; now: string; actions: StalledAction[]; unknown: { pr: number; reason: string }[] } {
  const { role, now, sessionUrl } = input;
  const actions: StalledAction[] = [];
  const unknown: { pr: number; reason: string }[] = [];
  const humanWaiting: string[] = [LABEL.blockedQuestion, LABEL.needsHuman, LABEL.epic];
  const issueByNumber = new Map(input.issues.map((i) => [i.number, i]));
  const startOf = (labels: string[]) => START_LABELS.filter((l) => labels.includes(l));
  const note = (text: string, action: string, commit?: string) => stalledComment(role, action, text, sessionUrl, commit);
  const handledIssues = new Set<number>();

  for (const pr of input.prs) {
    const m = ISSUE_BRANCH_RE.exec(pr.headRef);
    const issueNo = m ? Number(m[1]) : null;
    const issue = issueNo !== null ? issueByNumber.get(issueNo) : undefined;
    if (issueNo !== null) handledIssues.add(issueNo);
    if (pr.labels.includes(LABEL.needsHuman)) continue;
    if (issue && issue.labels.some((l) => humanWaiting.includes(l))) continue;
    const idle = Math.min(
      minutesSince(pr.updatedAt, now),
      issue ? minutesSince(issue.updatedAt, now) : Infinity,
    );
    const started = issue ? startOf(issue.labels) : [];
    const base = { target: "pr" as const, number: pr.number, removeLabels: [] as string[], addLabels: [] as string[], issue: null };
    const push = (a: Partial<StalledAction> & { action: string; comment: string | null }) => {
      actions.push({ ...base, draft: null, ...a });
    };
    const toHuman = (action: string, text: string, commit?: string) =>
      push({ action, addLabels: [LABEL.needsHuman], comment: note(text, action, commit) });
    const sha7 = pr.headSha.slice(0, 7);
    // 同じコミットに同じ処置を 2 回しない。2 回目は draft の切り替えをせず、人に回す
    const once = (a: Partial<StalledAction> & { action: string }, text: string) => {
      if (pr.priorMarks.some((m) => m.action === a.action && sameCommit(m.commit, pr.headSha)))
        push({ action: a.action, addLabels: [LABEL.needsHuman], comment: stalledComment(role, `${a.action}-repeat`, `同じ処置（${a.action}）を同じコミットに 2 回しても動かないので、人に回す。`, sessionUrl, sha7) });
      else push({ ...a, comment: note(text, a.action, sha7) });
    };
    const stopIssue = (text: string) => {
      actions.push({
        target: "issue",
        number: issue!.number,
        action: "stalled",
        removeLabels: started,
        addLabels: [LABEL.needsHuman],
        draft: null,
        issue: null,
        comment: note(text, "stalled"),
      });
    };

    // 3: レビューが動かなかった（claude/ のすべての PR。レビューの起動の取りこぼしは、出したセッションでは気づきにくい。#482・#518）
    const rereview = () => {
      if (!pr.draft && !pr.reviews.some((r) => sameCommit(r.commit, pr.headSha)) && !okCoversHead(pr) && pr.readyAt && minutesSince(pr.readyAt, now) >= 10) {
        once({ action: "rereview", draft: "draft-then-ready" }, "レビューが動かなかったので起こし直した。");
        return true;
      }
      return false;
    };
    if (issueNo === null && role !== "dispatch") {
      rereview(); // claude/issue- 以外の PR は、巡回はレビューの起こし直しだけ
      continue;
    }
    if (pr.mergeable === null) {
      unknown.push({ pr: pr.number, reason: "mergeable が null" });
      continue;
    }
    // 1・2: 衝突
    if (!pr.draft && pr.mergeable === false) {
      once({ action: "conflict", draft: "to-draft" }, "`main` と衝突しているので draft に戻した。衝突を直して Ready に戻す。");
      continue;
    }
    if (issueNo === null) {
      rereview(); // claude/issue- 以外は、衝突とレビューの起こし直しだけ
      continue;
    }
    if (pr.draft && pr.mergeable === false && idle >= 30) {
      once({ action: "conflict-kick", draft: "ready-then-draft" }, "衝突したまま止まっているので、修正の役を起こし直した。");
      continue;
    }
    if (rereview()) continue;
    // 4: 必須の指摘が直されないまま
    const latest = pr.reviews.at(-1);
    if (pr.draft && latest?.verdict === "changes" && sameCommit(latest.commit, pr.headSha) && idle >= 30) {
      toHuman("changes-stuck", "必須の指摘が直されないまま止まっているので、人に回す。");
      continue;
    }
    // 5: CI が通ったまま止まった draft
    if (pr.draft && pr.appCheck === "success" && changedAfterLatestReview(pr) && pr.mergeable === true && idle >= 15) {
      once(
        { action: "ready-stalled", draft: "to-ready", issue: started.length ? { number: issue!.number, removeLabels: started, addLabels: [] } : null },
        "CI が通ったまま止まっていたので Ready にした（レビューの役が動く）。",
      );
      continue;
    }
    // 6・7: 作業中の印が付いたまま止まった Issue
    if (issue && started.length && pr.draft) {
      if (pr.appCheck === "failure" && idle >= 30) {
        stopIssue("CI が落ちたまま 30 分動きが無いので、人に回す。");
        continue;
      }
      if (idle >= 60) {
        stopIssue("60 分動きが無いので、人に回す。");
        continue;
      }
    }
    // 8: 作業中の印が無く、CI が通らないまま止まった draft
    if (pr.draft && pr.appCheck !== "success" && started.length === 0 && idle >= 60) {
      toHuman("stalled-ci", "CI が通らないまま止まっているので、人に回す。");
      continue;
    }
    // 9: Mergify の時間切れで外れ、その後 CI も レビューも通っている
    const dequeued = pr.labels.some((l) => l === "merge:dequeued" || l === "dequeued");
    // merge:requested で入った PR も、レビューの status で自動で入った PR も同じ（Mergify は、キューに入っていた PR にだけ dequeued を付ける）
    if (dequeued && pr.mergifyTimeout && minutesSince(pr.mergifyTimeout.at, now) >= 5 && pr.appCheck === "success" && pr.bodyCheck === "success" && okCoversHead(pr)) {
      toHuman("checks-timeout", "Mergify の時間切れでキューから外れた。その後 CI は成功し、レビューも ok。人が `merge:requested` を付ける（付いていれば外して付け直す）と入り直す。");
      continue;
    }
  }

  // 7（PR が無い Issue）。PR がある Issue は上の PR の判定で扱った
  for (const issue of input.issues) {
    if (handledIssues.has(issue.number)) continue;
    const started = startOf(issue.labels);
    if (started.length === 0 || issue.labels.some((l) => humanWaiting.includes(l))) continue;
    if (minutesSince(issue.updatedAt, now) >= 60) {
      actions.push({
        target: "issue",
        number: issue.number,
        action: "stalled",
        removeLabels: started,
        addLabels: [LABEL.needsHuman],
        draft: null,
        issue: null,
        comment: stalledComment(role, "stalled", "60 分動きが無いので、人に回す。", sessionUrl),
      });
    }
  }
  // 10: 閉じた Issue に残った印
  for (const c of input.closedStarted) {
    const started = START_LABELS.filter((l) => c.labels.includes(l));
    if (started.length) actions.push({ target: "issue", number: c.number, action: "cleanup", removeLabels: started, addLabels: [], draft: null, issue: null, comment: null });
  }
  return { role, now, actions, unknown };
}
