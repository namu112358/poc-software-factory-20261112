// `claim.ts wait` の秒数の確かめ。

/** 待つ秒数の上限。割り当ての間隔（30 秒）・unknown の読み直し（60 秒）に足りる長さにとどめる */
export const WAIT_MAX_SECONDS = 600;

/**
 * `claim.ts wait <秒>` の秒数を読む。1〜WAIT_MAX_SECONDS の整数だけを受け付け、それ以外は例外。
 * 単独の `sleep` は Claude Code に断られ、`node -e "setTimeout(...)"` はフックに断られるため、待つのはこのサブコマンドで行う。
 */
export function parseWaitSeconds(value: string | undefined): number {
  const s = Number(value);
  if (value === undefined || !/^\d+$/.test(value) || !Number.isInteger(s) || s < 1 || s > WAIT_MAX_SECONDS) {
    throw new Error(`待つ秒数を 1〜${WAIT_MAX_SECONDS} の整数で指定する（例: node scripts/factory/claim.ts wait 30）`);
  }
  return s;
}
