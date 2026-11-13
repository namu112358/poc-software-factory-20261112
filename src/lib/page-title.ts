export const APP_TITLE = "タスク管理";

/** ページのタイトル。画面の名前（`h1` と同じ）に、アプリ名を続ける。 */
export function formatPageTitle(screenName: string): string {
  const name = screenName.trim();
  return name === "" ? APP_TITLE : `${name} - ${APP_TITLE}`;
}
