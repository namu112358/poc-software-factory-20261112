// 承認待ちの一覧の「承認」「却下」ボタンの処理。確認のダイアログと通信を引数で受け取り、画面に依らずに確かめられるようにする。
// 画面（クライアント）からも読むため、DB を使うモジュールは読み込まない。

export type ExtensionDecision = "approve" | "reject";

/** 判断する申請の、確認と送信に要る情報。 */
export type DecidableExtension = {
  id: number;
  taskId: number;
  taskTitle: string;
  requester: string; // 申請者の ID
  newDueDate: string; // 希望の期限 YYYY-MM-DD
};

export type DecideExtensionResult =
  | { status: "cancelled" } // 確認でキャンセルした。何も送っていない
  | { status: "decided"; message: string } // 判断した。一覧を読み込み直す
  | { status: "error"; message: string; reload: boolean }; // 判断できなかった。reload なら一覧を読み込み直す

type Deps = {
  confirm: (message: string) => boolean;
  fetch: (url: string, init: { method: "POST" }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
};

export const ALREADY_DECIDED_MESSAGE = "この申請はすでに判断されています。一覧を読み込み直しました。";

/**
 * 承認・却下のボタンを出すか。取りまとめる人だけに出し、自分の申請には出さない（ID で比べる）。
 * 画面の出し分けだけで、判断できるかは API（decideExtension）でも確かめる。
 */
export function canDecideExtension(requester: string, userId: string, isCoordinator: boolean): boolean {
  return isCoordinator && requester !== userId;
}

/** 確認のダイアログに出す文言。 */
export function decideConfirmMessage(ext: DecidableExtension, decision: ExtensionDecision): string {
  return decision === "approve"
    ? `タスク「${ext.taskTitle}」の期限を ${ext.newDueDate} に延長する申請を承認します。よろしいですか？`
    : `タスク「${ext.taskTitle}」の期限の延長（希望 ${ext.newDueDate}）の申請を却下します。よろしいですか？`;
}

/** 確認のダイアログで OK したときだけ、承認・却下の API を送る。キャンセルなら何も送らない。 */
export async function confirmAndDecideExtension(
  ext: DecidableExtension,
  decision: ExtensionDecision,
  deps: Deps,
): Promise<DecideExtensionResult> {
  if (!deps.confirm(decideConfirmMessage(ext, decision))) return { status: "cancelled" };
  const fallback = decision === "approve" ? "承認できませんでした。" : "却下できませんでした。";
  try {
    const res = await deps.fetch(`/api/tasks/${ext.taskId}/extensions/${ext.id}/${decision}`, { method: "POST" });
    if (res.ok) return { status: "decided", message: decision === "approve" ? "承認しました" : "却下しました" };
    if (res.status === 409) return { status: "error", message: ALREADY_DECIDED_MESSAGE, reload: true };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    const message = typeof data?.error === "string" ? data.error : fallback;
    // 見ている間にタスクや申請が消えたときは、一覧を今の状態に合わせる。
    return { status: "error", message, reload: res.status === 404 };
  } catch {
    return { status: "error", message: fallback, reload: false };
  }
}
