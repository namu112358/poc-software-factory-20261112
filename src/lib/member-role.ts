// メンバーの一覧の「取りまとめる人にする」「メンバーに戻す」ボタンの処理（#524）。通信を引数で受け取り、画面に依らずに確かめられるようにする。
// 判定と書き込みは API（PUT /api/users/:id/role）と users.ts の changeUserRole が行う。
import { USER_ROLE_LABELS, type UserRole } from "./user-role.ts";

/**
 * メンバーの一覧で、その行に出す役割の操作（替えた後の役割）。出さないときは null。
 * 取りまとめる人にだけ出す。停止中の人を取りまとめる人にする操作は出さない。
 * 自分の行にも「メンバーに戻す」を出す（ほかに取りまとめる人がいなければ API が理由つきで断る）。
 */
export function roleControlFor(
  viewer: { isCoordinator: boolean },
  member: { role: UserRole; suspended: boolean },
): UserRole | null {
  if (!viewer.isCoordinator) return null;
  if (member.role === "coordinator") return "member";
  return member.suspended ? null : "coordinator";
}

/** ボタンの文言。 */
export function roleButtonLabel(to: UserRole): string {
  return to === "coordinator" ? "取りまとめる人にする" : "メンバーに戻す";
}

/** 替える前に確かめる文言。自分をメンバーに戻すときは、権限を失うことを伝える。 */
export function roleConfirmMessage(name: string, to: UserRole, self: boolean): string {
  if (to === "coordinator") {
    return `${name} さんを取りまとめる人にしますか？ 延長の承認・却下、メンバーの追加・停止・役割の変更ができるようになります。`;
  }
  if (self) {
    return "自分をメンバーに戻しますか？ 戻すと、延長の承認・却下、メンバーの追加・停止・役割の変更ができなくなります。";
  }
  return `${name} さんをメンバーに戻しますか？ 延長の承認・却下、メンバーの追加・停止・役割の変更ができなくなります。`;
}

/** 一覧の「役割」の欄の文言。 */
export function roleLabel(role: UserRole): string {
  return USER_ROLE_LABELS[role];
}

export type RoleChangeUiResult = { status: "done"; role: UserRole } | { status: "error"; message: string };

type Deps = {
  fetch: (
    url: string,
    init: { method: "PUT"; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

const FALLBACK = "役割を替えられませんでした。";

/** メンバーの役割を to に替える。失敗したときは、画面に出す日本語の理由（API の error）を返す。 */
export async function setMemberRole(memberId: string, to: UserRole, deps: Deps): Promise<RoleChangeUiResult> {
  try {
    const res = await deps.fetch(`/api/users/${encodeURIComponent(memberId)}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: to }),
    });
    if (res.ok) return { status: "done", role: to };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { status: "error", message: typeof data?.error === "string" && data.error !== "" ? data.error : FALLBACK };
  } catch {
    return { status: "error", message: FALLBACK };
  }
}
