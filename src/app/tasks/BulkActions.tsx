"use client";
// タスク一覧で複数のタスクを選び、担当者・ステータスをまとめて変える部品。
// 選択の状態は BulkSelection が持つ。絞り込みが変わったら、一覧の画面が key を変えて作り直す（選択が外れる）。
// ログインが切れていたら（401）、選択と選んだ値を残し、画面を読み直さずに（読み直すとログイン画面へ移る）、ログインし直す案内を出す（#491）。
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  BULK_UNDO_MINUTES,
  canSelectMore,
  canSubmitBulk,
  confirmAndBulkUpdate,
  keepVisible,
  requestBulkUndo,
  toggleSelection,
  type BulkChoice,
} from "@/lib/bulk-select";
import { STATUS_LABELS, TASK_STATUSES } from "@/lib/task-types";
import { SessionExpiredNotice } from "../session-expired";

type User = { id: string; name: string; label?: string };

type State = {
  selected: number[];
  toggle: (id: number, checked: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<State | null>(null);

function useSelection(): State {
  const state = useContext(SelectionContext);
  if (state === null) throw new Error("BulkSelection の中で使ってください");
  return state;
}

/** 選択の状態を持つ。一覧に見えていないタスクは選択に数えない（読み込み直して消えたタスクを残さない）。 */
export function BulkSelection({ visibleIds, children }: { visibleIds: number[]; children: ReactNode }) {
  const [raw, setRaw] = useState<number[]>([]);
  const selected = keepVisible(raw, visibleIds);
  const state: State = {
    selected,
    toggle: (id, checked) => setRaw(toggleSelection(selected, id, checked)),
    clear: () => setRaw([]),
  };
  return <SelectionContext.Provider value={state}>{children}</SelectionContext.Provider>;
}

/** 行のチェックボックス。上限まで選んだら、まだ選んでいない行は選べない。 */
export function BulkCheckbox({ id, title }: { id: number; title: string }) {
  const { selected, toggle } = useSelection();
  const checked = selected.includes(id);
  return (
    <input
      type="checkbox"
      data-testid="bulk-select"
      aria-label={`「${title}」を選ぶ`}
      checked={checked}
      disabled={!canSelectMore(selected, id)}
      onChange={(e) => toggle(id, e.target.checked)}
    />
  );
}

/**
 * 1 件以上選んだときに一覧の上に出る、まとめて変える操作。結果の文言は選択が外れても残す。
 * 変えた直後は「元に戻す」ボタンを出す（変えてから BULK_UNDO_MINUTES 分で消す。期間と本人かどうかは API が判定する）。
 */
export function BulkBar({ users }: { users: User[] }) {
  const router = useRouter();
  const { selected, clear } = useSelection();
  const [choice, setChoice] = useState<BulkChoice>({ assignee: "", status: "" });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ kind: "done" | "error" | "expired"; message: string }>();
  const [undoId, setUndoId] = useState<number>();

  useEffect(() => {
    if (undoId === undefined) return;
    const timer = setTimeout(() => setUndoId(undefined), BULK_UNDO_MINUTES * 60 * 1000);
    return () => clearTimeout(timer);
  }, [undoId]);

  async function onUndo() {
    if (undoId === undefined) return;
    setPending(true);
    const r = await requestBulkUndo(undoId, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    if (r.status === "expired") {
      // 元に戻すボタンは残す（ログインし直した後に押せるように）。
      setResult({ kind: "expired", message: r.message });
      return;
    }
    setUndoId(undefined);
    setResult({ kind: r.status === "undone" ? "done" : "error", message: r.message });
    router.refresh();
  }

  async function onSubmit() {
    setResult(undefined);
    setUndoId(undefined);
    setPending(true);
    const r = await confirmAndBulkUpdate(selected, choice, users, {
      confirm: (message) => window.confirm(message),
      fetch: (url, init) => fetch(url, init),
    });
    setPending(false);
    if (r.status === "cancelled") return;
    if (r.status === "expired") {
      setResult({ kind: "expired", message: r.message });
      return;
    }
    if (r.status === "updated") {
      clear();
      setChoice({ assignee: "", status: "" });
      setResult({ kind: "done", message: r.message });
      setUndoId(r.undo?.id);
    } else {
      setResult({ kind: "error", message: r.message });
    }
    router.refresh();
  }

  return (
    <>
      {selected.length > 0 && (
        <div role="group" aria-label="まとめて変更" data-testid="bulk-bar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
          <span data-testid="bulk-count">選んだ {selected.length} 件を</span>
          <label>
            担当者を{" "}
            <select value={choice.assignee} onChange={(e) => setChoice({ ...choice, assignee: e.target.value })} data-testid="bulk-assignee">
              <option value="">変えない</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label ?? u.name}
                </option>
              ))}
            </select>
            に
          </label>
          <label>
            ステータスを{" "}
            <select value={choice.status} onChange={(e) => setChoice({ ...choice, status: e.target.value })} data-testid="bulk-status">
              <option value="">変えない</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            に
          </label>
          <button type="button" onClick={onSubmit} disabled={pending || !canSubmitBulk(selected, choice)} data-testid="bulk-submit">
            まとめて変更
          </button>
        </div>
      )}
      {result && (
        <p role={result.kind === "done" ? "status" : "alert"} data-testid="bulk-result">
          {result.kind === "expired" ? (
            <>
              {result.message} <SessionExpiredNotice />
            </>
          ) : (
            result.message
          )}
          {undoId !== undefined && (
            <>
              {" "}
              <button type="button" onClick={onUndo} disabled={pending} data-testid="bulk-undo">
                元に戻す
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}
