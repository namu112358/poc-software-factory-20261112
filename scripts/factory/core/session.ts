// セッションの ID の取り出し（`claim.ts session-id`。各サブコマンドが、コメントに書くセッションの URL にも使う）。

/**
 * クラウドのセッションの URL（環境変数 CLAUDE_CODE_REMOTE_SDK_URL）から、コメントに書くセッションの ID（session_...）を取り出す。
 * URL の `cse_<ID>` を `session_<ID>` に読み替える。無い・形が違うときは null（ID を手で書かせないため。#156）。
 */
export function sessionIdFromUrl(url: string | undefined): string | null {
  const m = /cse_([A-Za-z0-9]+)/.exec(url ?? "");
  return m ? `session_${m[1]}` : null;
}
