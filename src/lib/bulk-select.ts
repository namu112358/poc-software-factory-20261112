// タスク一覧で複数のタスクを選び、担当者・ステータスをまとめて変える画面の処理。
// 画面（クライアント）からも読み込むので、DB を使うモジュールは読み込まない。確認のダイアログと通信は引数で受け取る。
import { STATUS_LABELS, isTaskStatus, type TaskStatus } from "./task-types.ts";

/** 一度に選べるタスクの最大件数。まとめて変える API の上限と同じ。 */
export const BULK_SELECT_MAX = 100;

/** 選んだ変更。空文字は「変えない」。 */
export type BulkChoice = { assignee: string; status: string };

export type BulkChanges = { assignee?: string; status?: TaskStatus };

/** 変えた本人が元に戻せる期間（分）。 */
export const BULK_UNDO_MINUTES = 10;

/** 元に戻すための記録の ID と、値が実際に変わったタスクの数（API の応答の `undo`）。 */
export type BulkUndoOffer = { id: number; count: number };

export type BulkSubmitResult =
  | { status: "cancelled" }
  | { status: "updated"; count: number; message: string; undo?: BulkUndoOffer }
  | { status: "error"; message: string };

type Deps = {
  confirm: (message: string) => boolean;
  fetch: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
};

/**
 * チェックボックスを切り替えたあとの選択を返す。選ぶときは、すでに上限まで選んでいれば足さない（101 件目は選べない）。
 * 同じ ID は 2 回入れない。
 */
export function toggleSelection(selected: readonly number[], id: number, checked: boolean): number[] {
  if (!checked) return selected.filter((x) => x !== id);
  if (selected.includes(id) || selected.length >= BULK_SELECT_MAX) return [...selected];
  return [...selected, id];
}

/** まだ選んでいない行を選べるか。上限に達したら、選んでいない行は選べない。 */
export function canSelectMore(selected: readonly number[], id: number): boolean {
  return selected.includes(id) || selected.length < BULK_SELECT_MAX;
}

/** 一覧に見えているタスクだけを選択に残す（読み込み直して消えたタスクを選んだまま残さない）。 */
export function keepVisible(selected: readonly number[], visibleIds: readonly number[]): number[] {
  const visible = new Set(visibleIds);
  return selected.filter((id) => visible.has(id));
}

/** 選んだ変更から、API に送る changes を作る。「変えない」の項目は入れない。ステータスが不正なら入れない。 */
export function bulkChanges(choice: BulkChoice): BulkChanges {
  const changes: BulkChanges = {};
  if (choice.assignee !== "") changes.assignee = choice.assignee;
  if (isTaskStatus(choice.status)) changes.status = choice.status;
  return changes;
}

/** 「まとめて変更」を押せるか。1 件以上選び、担当者かステータスの少なくとも一方を選んでいるとき。 */
export function canSubmitBulk(selected: readonly number[], choice: BulkChoice): boolean {
  return selected.length > 0 && Object.keys(bulkChanges(choice)).length > 0;
}

/** 選択の状態を作り直すためのキー。絞り込み・並び順のどれかが変わると値が変わる。 */
export function bulkSelectionKey(filter: {
  status?: string;
  assignee?: string;
  assignees?: readonly string[];
  tag?: string;
  tags?: readonly string[];
  q?: string;
  due?: string;
  sort?: string;
  includeArchived?: boolean;
}): string {
  return JSON.stringify([
    filter.status ?? "",
    filter.assignee ?? "",
    filter.assignees ?? [],
    filter.tag ?? "",
    filter.tags ?? [],
    filter.q ?? "",
    filter.due ?? "",
    filter.sort ?? "",
    filter.includeArchived === true,
  ]);
}

/** 確認のダイアログに出す文言（件数と変更の中身）。 */
export function bulkConfirmMessage(count: number, changes: BulkChanges, users: readonly { id: string; name: string }[]): string {
  const parts: string[] = [];
  if (changes.assignee !== undefined) {
    const name = users.find((u) => u.id === changes.assignee)?.name ?? changes.assignee;
    parts.push(`担当者を「${name}」`);
  }
  if (changes.status !== undefined) parts.push(`ステータスを「${STATUS_LABELS[changes.status]}」`);
  return `選んだ ${count} 件のタスクの${parts.join("、")}に変更します。よろしいですか？`;
}

/** 変更が終わったときの文言。 */
export function bulkDoneMessage(count: number): string {
  return `${count} 件を変更しました`;
}

/** 元に戻すを出すときの文言。例: 「3 件の担当者を変えました。」（変えた項目が両方なら「担当者とステータス」）。 */
export function bulkUndoOfferMessage(count: number, changes: BulkChanges): string {
  const parts: string[] = [];
  if (changes.assignee !== undefined) parts.push("担当者");
  if (changes.status !== undefined) parts.push("ステータス");
  return `${count} 件の${parts.join("と")}を変えました。`;
}

/** API の応答の `undo` を読む。正の整数の id と 1 以上の count があるときだけ返す（0 件なら元に戻すものが無い）。 */
export function parseUndoOffer(data: unknown): BulkUndoOffer | undefined {
  const undo = (data as { undo?: unknown } | null)?.undo as { id?: unknown; count?: unknown } | null | undefined;
  if (typeof undo !== "object" || undo === null) return undefined;
  const { id, count } = undo;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return undefined;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) return undefined;
  return { id, count };
}

/** 失敗したときの文言。API の応答の状態と本文から、日本語の理由を作る。 */
export function bulkErrorMessage(httpStatus: number, body: unknown): string {
  if (httpStatus === 404) return "見つからないタスクがあります。1 件も変更していません。";
  if (httpStatus === 401) return "ログインし直してください。1 件も変更していません。";
  if (httpStatus === 400) {
    const details = (body as { details?: unknown } | null)?.details;
    const reasons = Array.isArray(details) ? details.filter((d): d is string => typeof d === "string") : [];
    return `${reasons.length > 0 ? reasons.join("、") : "入力内容に誤りがあります"}。1 件も変更していません。`;
  }
  return "変更できませんでした。1 件も変更していません。";
}

/**
 * 確認のダイアログで OK したときだけ、POST /api/tasks/bulk-update を 1 回送る。キャンセル・送れる変更が無いときは何も送らない。
 * 全部か無しかは API が守る（1 件でも見つからなければ、どのタスクも変えない）。
 */
export async function confirmAndBulkUpdate(
  ids: readonly number[],
  choice: BulkChoice,
  users: readonly { id: string; name: string }[],
  deps: Deps,
): Promise<BulkSubmitResult> {
  const changes = bulkChanges(choice);
  if (!canSubmitBulk(ids, choice)) return { status: "cancelled" };
  if (!deps.confirm(bulkConfirmMessage(ids.length, changes, users))) return { status: "cancelled" };
  try {
    const res = await deps.fetch("/api/tasks/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, changes }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      const undo = parseUndoOffer(data);
      if (undo === undefined) return { status: "updated", count: ids.length, message: bulkDoneMessage(ids.length) };
      return { status: "updated", count: ids.length, message: bulkUndoOfferMessage(undo.count, changes), undo };
    }
    return { status: "error", message: bulkErrorMessage(res.status, data) };
  } catch {
    return { status: "error", message: bulkErrorMessage(0, null) };
  }
}

export type BulkUndoSubmitResult = { status: "undone" | "error"; message: string };

type UndoDeps = {
  fetch: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
};

/** 元に戻した結果の文言。戻せなかったタスクがあれば、その件数と理由も出す。 */
export function bulkUndoDoneMessage(restored: number, skipped: number): string {
  const done = `${restored} 件を元に戻しました。`;
  if (skipped === 0) return done;
  return `${done}${skipped} 件は、変えた後にほかの変更があった（または削除された）ため、戻していません。`;
}

/** POST /api/tasks/bulk-update/undo を 1 回送る。断られたら API のエラー文言を、通信に失敗したら決まった文言を返す。 */
export async function requestBulkUndo(id: number, deps: UndoDeps): Promise<BulkUndoSubmitResult> {
  const fallback = "元に戻せませんでした。";
  try {
    const res = await deps.fetch("/api/tasks/bulk-update/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = (await res.json().catch(() => null)) as { restoredIds?: unknown; skippedIds?: unknown; error?: unknown } | null;
    if (res.ok) {
      const restored = Array.isArray(data?.restoredIds) ? data.restoredIds.length : 0;
      const skipped = Array.isArray(data?.skippedIds) ? data.skippedIds.length : 0;
      return { status: "undone", message: bulkUndoDoneMessage(restored, skipped) };
    }
    return { status: "error", message: typeof data?.error === "string" ? data.error : fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}
