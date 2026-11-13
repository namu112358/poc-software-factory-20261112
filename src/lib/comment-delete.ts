// コメントの「削除」と「元に戻す」ボタンの処理。確認のダイアログと通信を引数で受け取り、画面に依らずに確かめられるようにする。
import { RESTORE_DAYS } from "./task-dates.ts";

export type ConfirmDeleteCommentResult = { status: "cancelled" } | { status: "deleted" } | { status: "error"; message: string };

type Deps = {
  confirm: (message: string) => boolean;
  fetch: (url: string, init: { method: "DELETE" }) => Promise<{ ok: boolean }>;
};

const PREVIEW_LENGTH = 30;

/** コメントの先頭 30 文字まで。それより長ければ末尾に「…」を付ける。 */
export function commentPreview(body: string): string {
  const chars = Array.from(body);
  return chars.length > PREVIEW_LENGTH ? `${chars.slice(0, PREVIEW_LENGTH).join("")}…` : body;
}

/** 確認のダイアログに出す文言。 */
export function deleteCommentConfirmMessage(body: string): string {
  return `このコメントを削除します。削除してから ${RESTORE_DAYS} 日のあいだは元に戻せます。よろしいですか？\n\n「${commentPreview(body)}」`;
}

/** 確認のダイアログで OK したときだけ DELETE を送る。キャンセルなら何も送らない。 */
export async function confirmAndDeleteComment(
  taskId: number,
  commentId: number,
  body: string,
  deps: Deps,
): Promise<ConfirmDeleteCommentResult> {
  if (!deps.confirm(deleteCommentConfirmMessage(body))) return { status: "cancelled" };
  const fallback = "コメントを削除できませんでした。";
  try {
    const res = await deps.fetch(`/api/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" });
    return res.ok ? { status: "deleted" } : { status: "error", message: fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}

export type RestoreCommentClientResult = { status: "restored" } | { status: "error"; message: string };

/** 削除したコメントを戻す POST を送る。断られたときは API のエラーの文言を返す。 */
export async function requestRestoreComment(
  taskId: number,
  commentId: number,
  fetchImpl: (url: string, init: { method: "POST" }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
): Promise<RestoreCommentClientResult> {
  const fallback = "コメントを元に戻せませんでした。";
  try {
    const res = await fetchImpl(`/api/tasks/${taskId}/comments/${commentId}/restore`, { method: "POST" });
    if (res.ok) return { status: "restored" };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { status: "error", message: typeof data?.error === "string" ? data.error : fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}
