/** パスワード変更の画面に出す、「だれのパスワードを変えるか」の文言。 */
export function passwordOwnerMessage(name: string): string {
  return `${name} さんのパスワードを変更します。`;
}
