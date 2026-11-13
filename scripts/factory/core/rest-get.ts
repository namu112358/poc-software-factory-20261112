// `claim.ts rest-get` のパスの確かめ。

/**
 * `claim.ts rest-get <パス>` のパスを確かめる。このリポジトリの REST（`/repos/<repo>/...`）だけを読ませる。
 * `..`・空白・`per_page`・`page` を含むもの、`?` より前に `%`・`\`・`#` を含むものは断る（ページは claim.ts が読む。`&` はフックに断られるため）。
 */
export function parseRestPath(value: string | undefined, repo: string): string {
  const p = value ?? "";
  // `?` より前に `%`（%2e%2e など符号化した `..`）・`\`・`#` があれば、許可したパスの外に出られるので断る
  const pathPart = p.split("?")[0];
  const ok = p.startsWith(`/repos/${repo}/`) && !p.includes("..") && !/[%\\#]/.test(pathPart) && !/\s/.test(p) && !/[?&](per_page|page)=/.test(p);
  if (!ok) throw new Error(`/repos/${repo}/ で始まるパスを、per_page・page を付けずに指定する（例: node scripts/factory/claim.ts rest-get /repos/${repo}/issues/123/events）`);
  return p;
}
