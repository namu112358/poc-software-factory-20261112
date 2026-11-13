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

export type SuspensionToggleResult = { status: "done"; suspended: boolean } | { status: "error"; message: string };

type Deps = {
  fetch: (url: string, init: { method: "POST" | "DELETE" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

/** メンバーのログインを、suspend が true なら停止し、false なら再開する。失敗したときは日本語のメッセージを返す。 */
export async function setMemberSuspended(memberId: string, suspend: boolean, deps: Deps): Promise<SuspensionToggleResult> {
  const fallback = suspend ? "ログインを停止できませんでした。" : "ログインを再開できませんでした。";
  try {
    const res = await deps.fetch(`/api/users/${encodeURIComponent(memberId)}/suspension`, { method: suspend ? "POST" : "DELETE" });
    if (res.ok) return { status: "done", suspended: suspend };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { status: "error", message: typeof data?.error === "string" ? data.error : fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}
