// 書き込みの API の本文に、受け付ける項目のほかの項目が無いかを確かめる（#527）。
// 連携スクリプトが項目名を書き間違えても、黙って無視せずに 400 で知らせるため、各機能の検証の関数の最初で使う。
import type { ValidationResult } from "./task-types.ts";

/** サーバーが付ける項目。本文で送られても使わないので、知らない項目とは別の文言で断る。 */
export const SERVER_FIELDS = ["id", "createdAt", "updatedAt", "completedAt"] as const;

/** 本文（オブジェクト）の項目のうち、allowed に無いものを、項目ごとに 1 つの誤りの文言にして返す。無ければ空の配列。 */
export function unknownFieldErrors(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) =>
      (SERVER_FIELDS as readonly string[]).includes(key)
        ? `${key} はサーバーが付ける項目のため、送れません`
        : `${key} は受け付けない項目です（受け付ける項目: ${allowed.join("、")}）`,
    );
}

/**
 * 本文を、受け付ける項目のほかの項目が無いかと、各機能の検証（check）の両方で確かめる。
 * どちらにも誤りがあれば、知らない項目の誤りを先にして両方を返す。どちらかに誤りがあれば何も受け付けない。
 */
export function checkBodyFields<T>(
  body: Record<string, unknown>,
  allowed: readonly string[],
  check: (body: Record<string, unknown>) => ValidationResult<T>,
): ValidationResult<T> {
  const unknown = unknownFieldErrors(body, allowed);
  const result = check(body);
  if (unknown.length === 0) return result;
  return { ok: false, errors: [...unknown, ...(result.ok ? [] : result.errors)] };
}
