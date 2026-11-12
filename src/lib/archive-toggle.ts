// 詳細画面の「アーカイブする」「アーカイブを戻す」ボタンの処理。通信を引数で受け取り、画面に依らずに確かめられるようにする。
// 既存の PATCH /api/tasks/:id（archived）を使い、expectedUpdatedAt で同時に編集したときの上書きを防ぐ。

export type ArchiveToggleResult = { status: "done"; archived: boolean } | { status: "error"; message: string };

type Deps = {
  fetch: (
    url: string,
    init: { method: "PATCH"; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

/** タスクのアーカイブの状態を archived にする。失敗したときは日本語のメッセージを返す。 */
export async function setTaskArchived(
  taskId: number,
  archived: boolean,
  expectedUpdatedAt: string,
  deps: Deps,
): Promise<ArchiveToggleResult> {
  const fallback = archived ? "タスクをアーカイブできませんでした。" : "アーカイブを戻せませんでした。";
  try {
    const res = await deps.fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived, expectedUpdatedAt }),
    });
    if (res.ok) return { status: "done", archived };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { status: "error", message: typeof data?.error === "string" ? data.error : fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}
