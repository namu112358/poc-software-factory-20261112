// 役が書くコメントの印（`<!-- factory:<役> action=... -->`）。stalled・gate・ci-wait が使う。

export function stalledComment(role: string, action: string, text: string, sessionUrl: string | null, commit?: string): string {
  const mark = `<!-- factory:${role} action=${action}${commit ? ` commit=${commit}` : ""} -->`;
  return [mark, text, ...(sessionUrl ? [`セッション: ${sessionUrl}`] : [])].join("\n");
}
