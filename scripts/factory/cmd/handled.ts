// `claim.ts handled --since <ISO 8601>`: ほかの割り当てがもう処理した Issue・PR。

import { handledByOthers } from "../core/handled.ts";
import { REPO, arg, getAll, mySession, type RawComment } from "./github.ts";

export async function runHandled() {
  const since = arg("since");
  if (!since) throw new Error("--since <ISO 8601> を指定する");
  const raw = await getAll<RawComment>(`/repos/${REPO}/issues/comments?since=${encodeURIComponent(since)}`);
  const comments = raw.map((c) => ({ issue: Number(c.issue_url.split("/").pop()), body: c.body ?? "", createdAt: c.created_at }));
  return { since, mySession: mySession(), handled: handledByOthers({ comments, since, mySession: mySession() }) };
}
