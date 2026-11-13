// タグの長さの上限。画面の入力欄（maxLength）・上限の表示・保存のときの判定が、すべてこの値から作られる。
// 画面（クライアント）からも読むため、DB に依存しない。
export const TAG_MAX_LENGTH = 20;

/** 入力欄の近くに出す、タグの長さの上限の案内。 */
export function formatTagLimitHint(): string {
  return `タグは ${TAG_MAX_LENGTH} 文字までにしてください`;
}
