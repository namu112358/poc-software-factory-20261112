// パスワード変更画面の入力の確認と、API の応答から表示する理由の取り出し。
export const PASSWORD_MISMATCH_MESSAGE = "確認用のパスワードが一致しません";
export const PASSWORD_CHANGED_MESSAGE = "パスワードを変更しました";
export const PASSWORD_FAILED_MESSAGE = "パスワードを変更できませんでした";

/** 新しいパスワードと確認が一致していれば undefined、違えば表示する理由を返す。 */
export function checkPasswordConfirmation(newPassword: string, confirmation: string): string | undefined {
  return newPassword === confirmation ? undefined : PASSWORD_MISMATCH_MESSAGE;
}

/** API のエラー応答（`{ error, details? }`）から、画面に出す理由を取り出す。 */
export function passwordErrorMessages(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [PASSWORD_FAILED_MESSAGE];
  const { error, details } = body as { error?: unknown; details?: unknown };
  const list = Array.isArray(details) ? details.filter((d): d is string => typeof d === "string") : [];
  if (list.length > 0) return list;
  return [typeof error === "string" && error !== "" ? error : PASSWORD_FAILED_MESSAGE];
}
