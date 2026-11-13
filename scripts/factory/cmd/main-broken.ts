// main の CI の読み取り（pick・precheck が使う）。

import { REPO, get } from "./github.ts";

/** main の最新のコミットの app-check が失敗しているか（#363）。読めなければ false（ふだんどおり待たせる） */
export async function loadMainBroken(): Promise<boolean> {
  const { status, data } = await get<{ check_runs?: { name: string; conclusion: string | null; started_at: string }[] }>(`/repos/${REPO}/commits/main/check-runs?check_name=app-check`);
  if (status !== 200) return false;
  const latest = (data.check_runs ?? []).sort((a, b) => (a.started_at < b.started_at ? -1 : 1)).at(-1);
  return latest?.conclusion === "failure";
}
