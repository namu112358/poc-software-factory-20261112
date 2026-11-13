// コミットの共通の型と比べ方（stalled・gate・merge-check が使う）。

export type StalledCommit = { sha: string; mergeOnly: boolean; merge?: boolean }; // merge: main を取り込んだマージのコミット（2 つ目の親が main に含まれる。ほかのブランチのマージは false）。gate の軽い再レビューの判定に使う

export const sameCommit = (a: string, b: string) => a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a));
