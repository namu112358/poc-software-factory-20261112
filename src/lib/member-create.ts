// メンバーの一覧の「メンバーを加える」の処理（#523）。通信を引数で受け取り、画面に依らずに確かめられるようにする。
// 判定と書き込みは API（POST /api/users）と users.ts の createMember が行う。

/** メンバーの一覧に「メンバーを加える」を出すか。取りまとめる人だけに出す。 */
export function showAddMemberControl(viewer: { isCoordinator: boolean }): boolean {
  return viewer.isCoordinator;
}

/** 仮のパスワードを見せるときに添える注意。 */
export const TEMPORARY_PASSWORD_SHOWN_ONCE = "仮のパスワードは、この画面を離れると二度と表示されません。いま本人に伝えてください。本人は最初のログインで自分のパスワードに変えます。";

/** 仮のパスワードでログインした人に、パスワード変更の画面で出す知らせ。 */
export const TEMPORARY_PASSWORD_NOTICE = "仮のパスワードでログインしています。自分のパスワードに変えるまで、ほかの画面は使えません。今のパスワードの欄には、仮のパスワードを入れてください。";

export type AddMemberResult =
  | { status: "done"; user: { id: string; name: string }; temporaryPassword: string }
  | { status: "error"; messages: string[] };

type Deps = {
  fetch: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

const FALLBACK = "メンバーを加えられませんでした。";

/** メンバーのアカウントを作る。成功したら仮のパスワードを返し、失敗したら画面に出す日本語の理由（details があればそれ）を返す。 */
export async function addMember(userId: string, name: string, deps: Deps): Promise<AddMemberResult> {
  try {
    const res = await deps.fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      user?: { id?: unknown; name?: unknown };
      temporaryPassword?: unknown;
      error?: unknown;
      details?: unknown;
    };
    if (res.ok && typeof data.temporaryPassword === "string" && typeof data.user?.id === "string" && typeof data.user?.name === "string") {
      return { status: "done", user: { id: data.user.id, name: data.user.name }, temporaryPassword: data.temporaryPassword };
    }
    if (res.ok) return { status: "error", messages: [FALLBACK] };
    const details = Array.isArray(data.details) ? data.details.filter((d): d is string => typeof d === "string") : [];
    if (details.length > 0) return { status: "error", messages: details };
    return { status: "error", messages: [typeof data.error === "string" && data.error !== "" ? data.error : FALLBACK] };
  } catch {
    return { status: "error", messages: [FALLBACK] };
  }
}
