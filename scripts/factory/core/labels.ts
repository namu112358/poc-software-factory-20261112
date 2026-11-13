// ラベルの名前と、ラベルの組（どのサブコマンドも使う）。
// 用語: 「待っている Issue」は、status:ready があり status:in-progress / status:in-progress-hard の無い Issue（コード上は queued と呼ぶ。ラベルの queued はもう無い）。ラベルの名前は LABEL。

/**
 * ラベルの名前。用途のグループを接頭に付けている（status: 流れの状態、kind: Issue の分類、merge: マージの依頼）。
 * 名前を変えるときは、ここと手順書・.mergify.yml・Issue テンプレートを同じ PR で直す。
 */
export const LABEL = {
  ready: "status:ready",
  inProgress: "status:in-progress",
  inProgressHard: "status:in-progress-hard",
  blockedQuestion: "status:blocked-question",
  needsHuman: "status:needs-human",
  epic: "kind:epic",
  kaizen: "kind:kaizen",
  merge: "merge:requested",
  fix: "type:fix",
  riskHigh: "risk:high",
} as const;

/** 接頭を付ける前の名前 → 今の名前。過去のイベント（付けたときの名前のまま残る場合がある）を数えるときだけ使う */
export const OLD_LABEL_NAMES: Readonly<Record<string, string>> = {
  ready: LABEL.ready,
  "in-progress": LABEL.inProgress,
  "in-progress:hard": LABEL.inProgressHard,
  "blocked:question": LABEL.blockedQuestion,
  "needs-human": LABEL.needsHuman,
  epic: LABEL.epic,
  kaizen: LABEL.kaizen,
  merge: LABEL.merge,
};

/** 旧名なら今の名前に直す。それ以外はそのまま */
export function normalizeLabel(name: string): string {
  return OLD_LABEL_NAMES[name] ?? name;
}

/** 実装の開始の合図（実装の Routine のトリガー）。標準と難しい用 */
export const START_LABELS: readonly string[] = [LABEL.inProgress, LABEL.inProgressHard];

export const STALLED_LABELS: readonly string[] = [LABEL.needsHuman, LABEL.blockedQuestion];
/** 付いていれば着手させないラベル（作業中・人を待っている・実装しない）。#322 */
export const NOT_STARTABLE_LABELS: readonly string[] = [...START_LABELS, ...STALLED_LABELS, LABEL.epic, LABEL.kaizen];

/** 実装の着手のコメントの印（relabel と gate が使う） */
export const START_MARK_RE = /<!--\s*factory:implement action=start\s*-->/;
