// 詳細画面の「削除する」ボタンの処理。確認のダイアログと通信を引数で受け取り、画面に依らずに確かめられるようにする。

export type ConfirmDeleteResult = { status: "cancelled" } | { status: "deleted" } | { status: "error"; message: string };

type Deps = {
  confirm: (message: string) => boolean;
  fetch: (url: string, init: { method: "DELETE" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

/** 確認のダイアログに出す文言。 */
export function deleteConfirmMessage(title: string): string {
  return `タスク「${title}」を削除します。コメント・タグ・延長の申請も一緒に消え、元に戻せません。よろしいですか？`;
}

/** 確認のダイアログで OK したときだけ DELETE /api/tasks/:id を送る。キャンセルなら何も送らない。 */
export async function confirmAndDeleteTask(taskId: number, title: string, deps: Deps): Promise<ConfirmDeleteResult> {
  if (!deps.confirm(deleteConfirmMessage(title))) return { status: "cancelled" };
  const fallback = "タスクを削除できませんでした。";
  try {
    const res = await deps.fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (res.ok) return { status: "deleted" };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { status: "error", message: typeof data?.error === "string" ? data.error : fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}
