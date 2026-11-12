// 「この端末を切る」ボタンの処理。通信を引数で受け取り、画面に依らずに確かめられるようにする。

export type RevokeDeviceResult = { status: "revoked" } | { status: "error"; message: string };

type Deps = {
  fetch: (url: string, init: { method: "DELETE" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
};

/** DELETE /api/sessions/:id を送り、結果を返す。失敗したら画面に出す文言を返す。 */
export async function revokeDevice(deviceId: string, deps: Deps): Promise<RevokeDeviceResult> {
  const fallback = "端末を切れませんでした。";
  try {
    const res = await deps.fetch(`/api/sessions/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
    if (res.ok) return { status: "revoked" };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { status: "error", message: typeof data?.error === "string" ? data.error : fallback };
  } catch {
    return { status: "error", message: fallback };
  }
}
