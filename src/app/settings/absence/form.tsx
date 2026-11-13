"use client";
// 自分の休みの期間を登録・取り消すフォーム。結果は画面を読み込み直して出す。
// ログインが切れていたら（401）、入力を残したまま、ログインし直す案内を出す（#491）。
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import type { Absence } from "@/lib/absence";
import { readFormFailure } from "@/lib/session-expired";
import { SessionExpiredNotice } from "../../session-expired";

const FAILED_MESSAGE = "保存できませんでした。時間をおいてもう一度試してください";

export function AbsenceForm({ absence, onLeave }: { absence: Absence | null; onLeave: boolean }) {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);

  async function send(init: RequestInit, done: string) {
    setErrors([]);
    setExpired(false);
    setMessage(undefined);
    setPending(true);
    try {
      const res = await fetch("/api/absence", init);
      if (res.ok) {
        setMessage(done);
        router.refresh();
      } else {
        const failure = readFormFailure(res.status, await res.json().catch(() => undefined), FAILED_MESSAGE);
        if (failure.expired) setExpired(true);
        else setErrors(failure.messages);
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
      {expired && (
        <p role="alert" data-testid="absence-session-expired">
          <SessionExpiredNotice />
        </p>
      )}
      {errors.map((e) => (
        <p key={e} role="alert">
          {e}
        </p>
      ))}
    </>
  );
}
