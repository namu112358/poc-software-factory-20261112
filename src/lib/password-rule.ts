import { MIN_PASSWORD_LENGTH } from "./auth.ts";

/** パスワード変更の画面に出す、新しいパスワードの決まり。文字数は検証の処理（auth.ts）と同じ値を使う。 */
export function passwordRuleMessage(): string {
  return `新しいパスワードは ${MIN_PASSWORD_LENGTH} 文字以上で、今のパスワードと違うものにしてください。`;
}
