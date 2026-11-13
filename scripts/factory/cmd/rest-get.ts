// `claim.ts rest-get /repos/<repo>/<パス>`: このリポジトリの REST を GET で読む（一覧は全ページ。gh api・curl は許可に当たらないため）。

import { parseRestPath } from "../core/rest-get.ts";
import { REPO, get, getAll } from "./github.ts";

export async function runRestGet(num: string | undefined) {
  const path = parseRestPath(num, REPO);
  const sep = path.includes("?") ? "&" : "?";
  const first = await get<unknown>(`${path}${sep}per_page=100`);
  // 一覧（配列）なら、続きのページも読む（10 ページまで）
  if (first.status === 404) return { path, status: 404, data: null };
  if (Array.isArray(first.data)) return { path, status: first.status, data: await getAll<unknown>(path) };
  return { path, status: first.status, data: first.data };
}
