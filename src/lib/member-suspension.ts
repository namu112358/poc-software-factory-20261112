// メンバーの一覧の「停止」「再開」ボタンの処理（#522）。通信を引数で受け取り、画面に依らずに確かめられるようにする。
// 判定と書き込みは API（POST・DELETE /api/users/:id/suspension）と users.ts の suspendUser・resumeUser が行う。

/** メンバーの一覧で、その行に停止・再開の操作を出すか。取りまとめる人だけに出し、自分の行には出さない。 */
export function showSuspensionControl(viewer: { id: string; isCoordinator: boolean }, memberId: string): boolean {
  return viewer.isCoordinator && viewer.id !== memberId;
}

/** 停止する前に確かめる文言。 */
export function suspendConfirmMessage(name: string): string {
  return `${name} さんのログインを停止しますか？ ログイン中の端末はすべてログアウトし、担当者の選択肢から外れます。担当のタスクや記録は残ります。`;
}

/** 停止した人の担当のタスクを、その人で絞り込んだ一覧へのリンク。 */
export function memberTasksHref(memberId: string): string {
  return `/tasks?assignee=${encodeURIComponent(memberId)}`;
}

/** 停止した後に出す案内。残っている未完了のタスクの件数と、担当を替えに行く一覧へのリンクの要否。 */
export function suspendedNotice(name: string, openTaskCount: number): string {
  return openTaskCount > 0
    ? `${name} さんの未完了のタスクが ${openTaskCount} 件残っています。担当を替えてください。`
    : `${name} さんの未完了のタスクは残っていません。`;
}

export type SuspensionToggleResult = { status: "done"; suspended: boolean; openTaskCount?: number } | { status: "error"; message: string };

type Deps = {
  fetch: (url: string, init: { method: "POST" | "DELETE" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

/** メンバーのログインを、suspend が true なら停止し、false なら再開する。失敗したときは日本語のメッセージを返す。 */
export async function setMemberSuspended(memberId: string, suspend: boolean, deps: Deps): Promise<SuspensionToggleResult> {
  const fallback = suspend ? "ログインを停止できませんでした。" : "ログインを再開できませんでした。";
  try {
    const res = await deps.fetch(`/api/users/${encodeURIComponent(memberId)}/suspension`, { method: suspend ? "POST" : "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { error?: unknown; openTaskCount?: unknown };
    if (res.ok) {
      const n = data?.openTaskCount;
      return typeof n === "number" ? { status: "done", suspended: suspend, openTaskCount: n } : { status: "done", suspended: suspend };
    }
    return { status: "error", message: typeof data?.error === "string" ? data.error : fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}
