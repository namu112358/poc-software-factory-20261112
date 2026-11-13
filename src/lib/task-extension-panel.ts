// タスク詳細の「期限の延長」欄の判定と表示。画面（クライアント）からも読むため、DB を使うモジュールは読み込まない。
import { isSessionExpired } from "./session-expired.ts";

export const EXTENSION_NOT_AFTER_MESSAGE = "希望の期限は、今の期限より後の日付にしてください"; // lib/extensions.ts と同じ文（DB を読まないよう複製）

export const TASK_EXTENSION_RESULTS_MAX = 5;

export type PanelExtension = {
  id: number;
  newDueDate: string; // 希望の期限 YYYY-MM-DD
  status: "pending" | "approved" | "rejected";
  createdAt: string; // ISO 8601（UTC）
};

/** 申請の操作を出すか。自分が担当で、承認待ちの申請が無いときだけ（API の判定は変えない。画面だけの出し分け）。 */
export function canRequestExtension(assignee: string, userId: string, extensions: PanelExtension[]): boolean {
  return assignee === userId && !extensions.some((e) => e.status === "pending");
}

/** 承認待ちの申請（あれば 1 件）。 */
export function findPendingExtension<T extends PanelExtension>(extensions: T[]): T | undefined {
  return extensions.find((e) => e.status === "pending");
}

/** 申請の結果（承認待ちを除く）を、新しい順に 5 件まで返す。 */
export function recentExtensionResults<T extends PanelExtension>(extensions: T[]): T[] {
  return extensions
    .filter((e) => e.status !== "pending")
    .sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, TASK_EXTENSION_RESULTS_MAX);
}

/** 「YYYY-MM-DD」を「M/D」にする。 */
export function formatMonthDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function pendingExtensionLabel(newDueDate: string): string {
  return `承認待ち（希望の期限 ${formatMonthDay(newDueDate)}）`;
}

const RESULT_LABEL = { approved: "承認", rejected: "却下" } as const;

export function extensionResultLabel(e: PanelExtension): string {
  return `${RESULT_LABEL[e.status as "approved" | "rejected"]}（希望の期限 ${formatMonthDay(e.newDueDate)}）`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 画面で送る前の確認。今の期限より後の日付で、理由があるか。誤りの文言（日本語）を返す。 */
export function validateExtensionRequestForm(
  input: { newDueDate: string; reason: string },
  currentDueDate: string,
): string[] {
  const errors: string[] = [];
  if (!DATE_RE.test(input.newDueDate)) errors.push("希望の期限を入力してください");
  else if (input.newDueDate <= currentDueDate) errors.push(EXTENSION_NOT_AFTER_MESSAGE);
  if (input.reason.trim() === "") errors.push("理由を入力してください");
  return errors;
}

type Deps = {
  fetch: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
};

/** expired はログインが切れていた（401）とき。入力を残し、ログインし直す案内を出す（#491）。 */
export type SubmitExtensionResult = { status: "created" } | { status: "error"; message: string } | { status: "expired" };

/** 延長を申請する。入力の誤りなら送らない。 */
export async function submitExtensionRequest(
  taskId: number,
  input: { newDueDate: string; reason: string },
  currentDueDate: string,
  deps: Deps,
): Promise<SubmitExtensionResult> {
  const errors = validateExtensionRequestForm(input, currentDueDate);
  if (errors.length > 0) return { status: "error", message: errors.join(" ") };
  try {
    const res = await deps.fetch(`/api/tasks/${taskId}/extensions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newDueDate: input.newDueDate, reason: input.reason.trim() }),
    });
    if (res.ok) return { status: "created" };
    if (isSessionExpired(res.status)) return { status: "expired" };
    const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
    if (res.status === 409) return { status: "error", message: "承認待ちの申請がすでにあります。" };
    return { status: "error", message: data.details?.join(" ") ?? data.error ?? "延長を申請できませんでした。" };
  } catch {
    return { status: "error", message: "延長を申請できませんでした。" };
  }
}
