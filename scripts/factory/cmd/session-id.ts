// `claim.ts session-id`: このセッションの ID（session_...）と URL（コメントの最後の行・コミットの Claude-Session: に書く）。

import { mySession } from "./github.ts";

export function runSessionId() {
  const id = mySession();
  if (!id) throw new Error("環境変数 CLAUDE_CODE_REMOTE_SDK_URL が無いか、cse_ を含まない。セッションの ID は手で書かず、取れなかったことをコメントに書く");
  return { sessionId: id, url: `https://claude.ai/code/${id}` };
}
