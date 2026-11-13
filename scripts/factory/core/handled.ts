// 割り当ての役の重複の判定（`claim.ts handled`）。

/** 割り当ての役の重複（#220）: since より後に、ほかのセッションが factory:dispatch を書いた Issue・PR の番号 */
export function handledByOthers(args: {
  comments: { issue: number; body: string; createdAt: string }[];
  since: string;
  mySession: string | null;
}): number[] {
  const out = new Set<number>();
  for (const c of args.comments) {
    if (c.createdAt <= args.since) continue;
    if (!/^<!--\s*factory:dispatch/.test(c.body)) continue;
    const s = /claude\.ai\/code\/(session_[A-Za-z0-9]+)/.exec(c.body)?.[1] ?? null;
    if (args.mySession && s === args.mySession) continue;
    out.add(c.issue);
  }
  return [...out].sort((a, b) => a - b);
}
