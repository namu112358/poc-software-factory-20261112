// 新しいログインの知らせの「確かめた」ボタンの処理。通信を引数で受け取り、画面に依らずに確かめられるようにする（#478）。

export type AcknowledgeResult = { status: "acknowledged" } | { status: "error"; message: string };

type Deps = {
  fetch: (
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

/** POST /api/login-notices に、画面に出した知らせの throughId を送る。失敗したら画面に出す文言を返す。 */
export async function acknowledgeLoginNotice(throughId: number, deps: Deps): Promise<AcknowledgeResult> {
  const fallback = "知らせを消せませんでした。";
  try {
    const res = await deps.fetch("/api/login-notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ throughId }),
    });
    if (res.ok) return { status: "acknowledged" };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { status: "error", message: typeof data?.error === "string" ? data.error : fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}
