"use client";
// 承認待ちの申請の一覧。各行の「承認」「却下」は、確認のダイアログで OK したときだけ送り、結果を一覧の上に出して読み込み直す。
// ボタンは取りまとめる人にだけ出し、自分の申請の行には出さない。
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  canDecideExtension,
  confirmAndDecideExtension,
  type DecidableExtension,
  type ExtensionDecision,
} from "@/lib/extension-actions";

export type PendingExtensionView = DecidableExtension & {
  requesterName: string;
  currentDueDate: string;
  reason: string;
  requestedAt: string; // 表示用に整えた申請日時
  waitDays: number | null; // 48 時間以上待っているときの日数。満たなければ null
};

export function PendingExtensionsTable({
  rows,
  userId,
  isCoordinator,
}: {
  rows: PendingExtensionView[];
  userId: string;
  isCoordinator: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [pendingId, setPendingId] = useState<number>();

  async function decide(row: PendingExtensionView, decision: ExtensionDecision) {
    setPendingId(row.id);
    const result = await confirmAndDecideExtension(row, decision, {
      confirm: (text) => window.confirm(text),
      fetch: (url, init) => fetch(url, init),
    });
    setPendingId(undefined);
    if (result.status === "cancelled") return;
    if (result.status === "decided") {
      setMessage({ text: result.message, error: false });
      router.refresh();
      return;
    }
    setMessage({ text: result.message, error: true });
    if (result.reload) router.refresh();
  }

  return (
    <>
      {message && (
        <p data-testid="extensions-message" role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      {rows.length === 0 ? (
        <p data-testid="extensions-empty">承認待ちの申請はありません</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>タスク</th>
              <th>申請者</th>
              <th>今の期限</th>
              <th>希望の期限</th>
              <th>理由</th>
              <th>申請日時</th>
              <th>判断</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                data-testid="extension-row"
                style={r.waitDays !== null ? { background: "#ffe5e5", fontWeight: "bold" } : undefined}
              >
                <td>
                  <a href={`/tasks/${r.taskId}`}>{r.taskTitle}</a>
                </td>
                <td>{r.requesterName}</td>
                <td>{r.currentDueDate}</td>
                <td>
                  {r.newDueDate}
                  {r.alreadyExtended && (
                    <div data-testid="extension-already-extended">
                      期限はすでに希望の期限以降です。承認しても期限は変わりません
                    </div>
                  )}
                </td>
                <td>{r.reason}</td>
                <td>
                  {r.requestedAt}
                  {r.waitDays !== null && (
                    <div data-testid="long-wait" style={{ color: "#a00" }}>
                      2 日以上待っています（{r.waitDays} 日待ち）
                    </div>
                  )}
                </td>
                <td>
                  {canDecideExtension(r.requester, userId, isCoordinator) ? (
                    <>
                      <button
                        type="button"
                        data-testid="extension-approve"
                        disabled={pendingId !== undefined}
                        onClick={() => decide(r, "approve")}
                      >
                        承認
                      </button>{" "}
                      <button
                        type="button"
                        data-testid="extension-reject"
                        disabled={pendingId !== undefined}
                        onClick={() => decide(r, "reject")}
                      >
                        却下
                      </button>
                    </>
                  ) : r.requester === userId ? (
                    <span data-testid="extension-own">自分の申請</span>
                  ) : (
                    <span data-testid="extension-coordinator-only">取りまとめる人が判断します</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
