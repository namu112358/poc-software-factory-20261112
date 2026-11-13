// GitHub の REST を読む道具と、コマンドの引数・セッションの読み取り（どのサブコマンドも使う。読むだけで、書き込みはしない）。

import type { HeadRef } from "../core/repo.ts";
import { sessionIdFromUrl } from "../core/session.ts";

export const REPO = process.env.FACTORY_REPO ?? "namu112358/poc-software-factory-20261112";
const API = "https://api.github.com";

export type RawIssue = { number: number; body: string | null; state: string; pull_request?: unknown; labels?: { name: string }[] };
export type RawComment = { body: string | null; created_at: string; issue_url: string; user?: { login: string } };
export type RawPull = { number: number; draft: boolean; mergeable?: boolean | null; created_at: string; updated_at: string; head: HeadRef & { sha: string }; labels?: { name: string }[] };
export type RawTrustedComment = { body: string | null; updated_at: string; author_association: string; user?: { login: string } };

export async function get<T>(path: string): Promise<{ status: number; data: T }> {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`${API}${path}`, {
    // GitHub Actions の中では GITHUB_TOKEN で読む（クラウドのセッションでは、プロキシが認証を付ける）
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 404) return { status: 404, data: [] as T };
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return { status: res.status, data: (await res.json()) as T };
}

export async function getAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const { data } = await get<T[]>(`${path}${sep}per_page=100&page=${page}`);
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

/** PR のブランチ名 claude/issue-<番号> から Issue の番号を取り出す。それ以外は NaN */
export const issueOf = (ref: string) => Number(/^claude\/issue-(\d+)$/.exec(ref)?.[1] ?? NaN);

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function mySession(): string | null {
  return sessionIdFromUrl(process.env.CLAUDE_CODE_REMOTE_SDK_URL);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const sessionUrl = () => (mySession() ? `https://claude.ai/code/${mySession()}` : null);
