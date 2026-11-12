export type NavLink = { href: string; label: string };

/** 画面の上に並べる、タスクに関わる移動先（並びもこのとおり）。 */
export const HEADER_NAV_LINKS: readonly NavLink[] = [
  { href: "/tasks", label: "タスク一覧" },
  { href: "/tasks/new", label: "新しいタスク" },
  { href: "/overdue", label: "期限切れ" },
  { href: "/board", label: "ステータス別" },
  { href: "/members", label: "メンバー" },
  { href: "/tags", label: "タグ一覧" },
  { href: "/extensions", label: "承認待ちの延長" },
  { href: "/tasks/deleted", label: "削除したタスク" },
  { href: "/settings", label: "設定" },
];

/** 「設定」の画面にまとめた、自分の設定への移動先。 */
export const SETTINGS_NAV_LINKS: readonly NavLink[] = [
  { href: "/settings/password", label: "パスワード変更" },
  { href: "/settings/sessions", label: "ログイン中の端末" },
  { href: "/settings/absence", label: "休みの登録" },
];
