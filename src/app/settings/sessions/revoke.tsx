"use client";
// 「この端末を切る」ボタン。切れたら一覧を読み込み直す。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { revokeDevice } from "@/lib/device-revoke";

export function RevokeDeviceButton({ deviceId }: { deviceId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setError(undefined);
    setPending(true);
    const result = await revokeDevice(deviceId, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    if (result.status === "error") setError(result.message);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} data-testid="revoke-device">
        この端末を切る
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
