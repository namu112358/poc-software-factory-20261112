// `claim.ts wait <秒>`: 指定の秒数（1〜600）だけ待つ（GitHub は読まない。単独の sleep は Claude Code に断られるため）。

import { parseWaitSeconds } from "../core/wait.ts";
import { sleep } from "./github.ts";

export async function runWait(num: string | undefined) {
  const seconds = parseWaitSeconds(num);
  await sleep(seconds * 1000);
  return { waited: seconds };
}
