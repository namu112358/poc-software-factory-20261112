// レビューより後のコミットを git から読む（merge-check・review-status・stalled・gate が使う）。

import { spawnSync } from "node:child_process";
import type { StalledCommit } from "../core/commits.ts";

const git = (...a: string[]) => spawnSync("git", a, { encoding: "utf-8" });

/**
 * レビューのコミット（last）より後の PR のコミット（first-parent）と、それが「取り込みだけのコミット」か。
 * head が last と同じなら []。last が PR の履歴に無ければ null。手元の参照が古い・fetch に失敗したときは例外（付けずに、後でやり直す）。
 * merge-check と stalled が使う。
 */
export function commitsAfter(n: number, last: string, headSha: string): StalledCommit[] | null {
  if (headSha.startsWith(last)) return [];
  const fetched = git("fetch", "-q", "origin", `+pull/${n}/head:refs/factory/pr-${n}`, "+main:refs/factory/main");
  if (fetched.status !== 0) throw new Error(`git fetch に失敗した（${fetched.stderr.trim()}）。付けずに、後でやり直す。`);
  // 手元の参照が古いまま判定しないよう、取り込んだ PR の先頭が GitHub の head と同じかを確かめる
  const local = git("rev-parse", `refs/factory/pr-${n}`).stdout.trim();
  if (local !== headSha) throw new Error(`手元の PR の先頭（${local.slice(0, 7)}）が GitHub の head（${headSha.slice(0, 7)}）と違う。付けずに、後でやり直す。`);
  const list = git("rev-list", "--first-parent", `${last}..refs/factory/pr-${n}`);
  if (list.status !== 0) return null;
  return list.stdout.split("\n").filter(Boolean).map((sha) => {
    const parents = git("rev-list", "--parents", "-n1", sha).stdout.trim().split(" ").slice(1);
    const diff = git("show", "--format=", "--remerge-diff", sha).stdout.trim();
    // 取り込みだけのコミット: main を取り込んだ（2 つ目の親が main に含まれる）マージで、--remerge-diff の差分が空
    const fromMain = parents.length === 2 && git("merge-base", "--is-ancestor", parents[1], "refs/factory/main").status === 0;
    return { sha, mergeOnly: fromMain && diff === "", merge: fromMain };
  });
}
