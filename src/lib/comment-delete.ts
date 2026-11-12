// コメントの「削除」ボタンの処理。確認のダイアログと通信を引数で受け取り、画面に依らずに確かめられるようにする。

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
  return `このコメントを削除します。元に戻せません。よろしいですか？\n\n「${commentPreview(body)}」`;
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
