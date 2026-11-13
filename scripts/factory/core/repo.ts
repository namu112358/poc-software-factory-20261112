// 役が扱う PR・コメントの信頼の判定（フォークの PR・書き込み権限のない人を数えない）。

/**
 * 印を信じるのは、書き込み権限のある人（author_association が OWNER・MEMBER・COLLABORATOR）のレビュー・コメントだけ
 * （PR のレビューは誰でも書けるので、ほかの人が印を偽って ok にできないように）。
 */
export const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

export type HeadRef = { ref: string; repo?: { full_name: string } | null };

/**
 * 役が扱う PR か: このリポジトリのブランチで、名前が `claude/` で始まる。
 * フォークの PR は、ブランチ名を `claude/...` にしても対象にしない（片付けのラベル・draft の付け外し・コメントを、外の人が起こせないように）
 */
export function isOwnClaudePr(p: { head: HeadRef }, repo: string): boolean {
  return p.head.ref.startsWith("claude/") && isOwnHead(p.head.repo?.full_name ?? null, repo);
}

/** PR の head がこのリポジトリのブランチか（フォーク・消えたフォークは false）。フォークの判定はここだけに置く */
export function isOwnHead(headRepo: string | null, repo: string): boolean {
  return headRepo !== null && headRepo === repo;
}
