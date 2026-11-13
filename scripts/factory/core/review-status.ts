// レビューの結果の status の値（`claim.ts review-status`。GitHub Actions が使う）と、品質のゲートの一覧。

import { LABEL } from "./labels.ts";
import type { mergeCheck } from "./merge-check.ts";

/**
 * レビューを通ったことを表すコミットの status（context=factory-review）の値（自動でキューに入れる仕組み）。
 * 判定は merge-check のレビューの部分と同じ: 最新のコミットが ok のレビューを受けている（ok の後が取り込みだけのコミットなら引き継ぐ）なら success。
 * 最新のコミットへのレビューが ok でなければ failure。それ以外（レビューの後に中身の変わるコミットがある・レビューが無い）は付けない（null）。
 * risk:high の PR は人が merge:requested を付けてキューに入れるので、success は付けない（レビューの結果と risk:high の付く順が前後しても、自動で入らないように）。
 * 品質のゲート（CI・Mergify・Routine の手順書・判定のスクリプト・エージェントの規約・Ruleset）を変える PR も、success は付けない（人が確かめてマージする）。
 */
// CI の動きを決めるファイル（package.json の test のスクリプト・依存・TypeScript の設定）も含める（書き換えると CI を空にできるため）。
// tests/ は含めない（機能の PR はふつうテストを足す）。テストを外す・緩める変更は、レビューの役が見る（AGENTS.md の規約）。
export const GATE_PATHS = [
  ".mergify.yml",
  ".mergify/",
  ".github/",
  ".claude/",
  "scripts/",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/rulesets/",
  "package.json",
  "package-lock.json",
  ".npmrc",
  "tsconfig.json",
  "tests/factory-claim.test.ts",
];

export function touchesGate(files: string[]): string[] {
  return files.filter((f) => GATE_PATHS.some((g) => (g.endsWith("/") ? f.startsWith(g) : f === g || f.endsWith(`/${g}`))));
}

export function reviewStatus(mc: ReturnType<typeof mergeCheck>, headSha: string, labels: string[], files: string[] = []): { state: "success" | "failure" | null; description: string } {
  const onHead = mc.review !== null && (headSha.startsWith(mc.review.commit) || mc.review.commit.startsWith(headSha));
  if (mc.ok) {
    if (labels.includes(LABEL.riskHigh)) return { state: null, description: "risk:high の PR は、人が merge:requested を付けてキューに入れる。" };
    const gate = touchesGate(files);
    if (gate.length > 0) return { state: null, description: `品質のゲートを変える PR（${gate.slice(0, 3).join("、")}）は、人が確かめて merge:requested を付ける。` };
    return { state: "success", description: mc.reason };
  }
  if (onHead && mc.review !== null && mc.review.verdict !== "ok") return { state: "failure", description: mc.reason };
  return { state: null, description: mc.reason };
}

/**
 * 「最新のコミットがレビューを通った」ことを表す status（context=factory-reviewed）の値。merge:requested で人がキューに入れる PR にも要る
 * （人がラベルを付けた後の push が、レビューを受けないままマージされたため。#499）。
 * merge-check のレビューの部分と同じ判定で、ok なら success（risk:high・品質のゲートを変える PR でも付く）、最新のコミットへのレビューが ok でなければ failure、それ以外は付けない（null）。
 */
export function reviewedStatus(mc: ReturnType<typeof mergeCheck>, headSha: string): { state: "success" | "failure" | null; description: string } {
  const onHead = mc.review !== null && (headSha.startsWith(mc.review.commit) || mc.review.commit.startsWith(headSha));
  if (mc.ok) return { state: "success", description: mc.reason };
  if (onHead && mc.review !== null && mc.review.verdict !== "ok") return { state: "failure", description: mc.reason };
  return { state: null, description: mc.reason };
}
