// 新しいパスワードの強さの目安。送信できるかどうかの検証（auth.ts）とは無関係。
export type PasswordStrength = "weak" | "normal" | "strong";

export const PASSWORD_STRENGTH_LABELS: Record<PasswordStrength, string> = {
  weak: "弱い",
  normal: "普通",
  strong: "強い",
};

function countCharacterKinds(password: string): number {
  const kinds = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];
  return kinds.filter((re) => re.test(password)).length;
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  const length = [...password].length;
  const kinds = countCharacterKinds(password);
  if (length >= 12 && kinds >= 3) return "strong";
  if (length >= 8 && kinds >= 2) return "normal";
  return "weak";
}

// 空のときは表示しない（undefined）。
export function passwordStrengthText(password: string): string | undefined {
  if (password === "") return undefined;
  return `強さ: ${PASSWORD_STRENGTH_LABELS[evaluatePasswordStrength(password)]}`;
}
