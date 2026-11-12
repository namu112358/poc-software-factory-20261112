// 詳細画面の「削除する」ボタンと、「削除したタスク」の画面の「元に戻す」ボタンの処理。
// 確認のダイアログと通信を引数で受け取り、画面に依らずに確かめられるようにする。
import { RESTORE_DAYS } from "./task-dates.ts";

export type ConfirmDeleteResult = { status: "cancelled" } | { status: "deleted" } | { status: "error"; message: string };

type Deps = {
  confirm: (message: string) => boolean;
  fetch: (url: string, init: { method: "DELETE" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

/** 確認のダイアログに出す文言。 */
export function deleteConfirmMessage(title: string): string {
  return `タスク「${title}」を削除します。削除してから ${RESTORE_DAYS} 日のあいだは、「削除したタスク」の画面からコメント・タグ・延長の申請ごと元に戻せます。よろしいですか？`;
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

export type RestoreResult = { status: "restored" } | { status: "error"; message: string };

type RestoreDeps = {
  fetch: (url: string, init: { method: "POST" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

/** POST /api/tasks/:id/restore を送り、削除したタスクを元に戻す。断られたら API のエラー文言を、通信に失敗したら決まった文言を返す。 */
export async function requestRestoreTask(taskId: number, deps: RestoreDeps): Promise<RestoreResult> {
  const fallback = "タスクを元に戻せませんでした。";
  try {
    const res = await deps.fetch(`/api/tasks/${taskId}/restore`, { method: "POST" });
    if (res.ok) return { status: "restored" };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { status: "error", message: typeof data?.error === "string" ? data.error : fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}
