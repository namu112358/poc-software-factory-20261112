"use client";
// 自分の休みの期間を登録・取り消すフォーム。結果は画面を読み込み直して出す。
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import type { Absence } from "@/lib/absence";

const FAILED_MESSAGE = "保存できませんでした。時間をおいてもう一度試してください";

async function errorMessages(res: Response): Promise<string[]> {
  const body = (await res.json().catch(() => undefined)) as { error?: unknown; details?: unknown } | undefined;
  if (Array.isArray(body?.details) && body.details.length > 0) return body.details.map(String);
  return [typeof body?.error === "string" ? body.error : FAILED_MESSAGE];
}

export function AbsenceForm({ absence, onLeave }: { absence: Absence | null; onLeave: boolean }) {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);

  async function send(init: RequestInit, done: string) {
    setErrors([]);
    setMessage(undefined);
    setPending(true);
    try {
      const res = await fetch("/api/absence", init);
      if (res.ok) {
        setMessage(done);
        router.refresh();
      } else {
        setErrors(await errorMessages(res));
      }
    } catch {
      setErrors([FAILED_MESSAGE]);
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void send(
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: String(data.get("startDate") ?? ""), endDate: String(data.get("endDate") ?? "") }),
      },
      "休みを登録しました",
    );
  }

  return (
    <>
      <p data-testid="absence-current">
        {absence
          ? `登録中の休み: ${absence.startDate} 〜 ${absence.endDate}${onLeave ? "（今日は休み中）" : ""}`
          : "登録中の休みはありません"}
      </p>
      <form onSubmit={onSubmit} aria-label="休みの登録" noValidate>
        <p>
          <label>
            開始日 <input name="startDate" type="date" required defaultValue={absence?.startDate} key={absence?.startDate ?? "none"} />
          </label>
        </p>
        <p>
          <label>
            終了日 <input name="endDate" type="date" required defaultValue={absence?.endDate} key={absence?.endDate ?? "none"} />
          </label>
        </p>
        <button type="submit" disabled={pending}>
          登録
        </button>{" "}
        {absence && (
          <button type="button" disabled={pending} onClick={() => void send({ method: "DELETE" }, "休みの登録を取り消しました")}>
            登録を取り消す
          </button>
        )}
      </form>
      {message && <p role="status">{message}</p>}
      {errors.map((e) => (
        <p key={e} role="alert">
          {e}
        </p>
      ))}
    </>
  );
}
