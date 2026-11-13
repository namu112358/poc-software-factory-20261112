// メンバーの休みの期間（1 人につき 1 つ）。登録・取り消しはログイン中の本人だけができる。
import { getDb, type Db } from "./db/index.ts";
import { todayInJapan } from "./task-dates.ts";
import type { ValidationResult } from "./task-types.ts";
import { unknownFieldErrors } from "./body-fields.ts";

/** 休みの期間。日付は日本時間の YYYY-MM-DD で、開始日と終了日を両方含む。 */
export type Absence = { startDate: string; endDate: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD の形で、実在する日付か（2026-02-30 などは誤り）。 */
function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** 本人の確認に使う `userId`（isOwnAbsenceTarget）を含め、休みの登録の本文で受け付ける項目。 */
export const ABSENCE_INPUT_FIELDS = ["startDate", "endDate", "userId"] as const;

/**
 * 休みの登録の本文（{ startDate, endDate }）を検証する。誤りは日本語の文言で返す。
 * ABSENCE_INPUT_FIELDS のほかの項目があれば誤り（#527）。
 */
export function validateAbsenceInput(body: unknown): ValidationResult<Absence> {
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const errors: string[] = unknownFieldErrors(record, ABSENCE_INPUT_FIELDS);
  const check = (key: "startDate" | "endDate", label: string): string | undefined => {
    const value = record[key];
    if (typeof value !== "string" || value === "") {
      errors.push(`${label}を入力してください`);
      return undefined;
    }
    if (!isValidDate(value)) {
      errors.push(`${label}は正しい日付（YYYY-MM-DD）で入力してください`);
      return undefined;
    }
    return value;
  };
  const startDate = check("startDate", "開始日");
  const endDate = check("endDate", "終了日");
  if (startDate && endDate && endDate < startDate) errors.push("終了日は開始日と同じ日か、それより後にしてください");
  if (errors.length > 0 || !startDate || !endDate) return { ok: false, errors };
  return { ok: true, value: { startDate, endDate } };
}

/**
 * 休みを登録・取り消す対象が、ログイン中の本人かを確かめる。
 * 対象（userId）を指定しなければ本人。本人以外を指定していれば false（API は 403 を返す）。
 */
export function isOwnAbsenceTarget(currentUserId: string, requestedUserId: unknown): boolean {
  return requestedUserId === undefined || requestedUserId === null || requestedUserId === currentUserId;
}

/** メンバーの休みの期間。登録が無ければ null。 */
export function getAbsence(userId: string, db: Db = getDb()): Absence | null {
  const row = db.prepare("SELECT start_date AS startDate, end_date AS endDate FROM user_absences WHERE user_id = ?").get(userId) as
    | Absence
    | undefined;
  return row ? { startDate: row.startDate, endDate: row.endDate } : null;
}

/** 休みの期間を登録する。前の登録があれば置き換える（期間は 1 つだけ）。 */
export function setAbsence(userId: string, absence: Absence, db: Db = getDb()): void {
  db.prepare(
    "INSERT INTO user_absences (user_id, start_date, end_date) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET start_date = excluded.start_date, end_date = excluded.end_date",
  ).run(userId, absence.startDate, absence.endDate);
}

/** 休みの登録を取り消す。登録が無くても何もせずに終える。 */
export function clearAbsence(userId: string, db: Db = getDb()): void {
  db.prepare("DELETE FROM user_absences WHERE user_id = ?").run(userId);
}

/** 今日（日本時間）が休みの期間に入っているか（開始日・終了日を含む）。 */
export function isOnLeave(absence: Absence | null, today: string = todayInJapan()): boolean {
  return absence !== null && absence.startDate <= today && today <= absence.endDate;
}

/** 休み中の全メンバーの、休みの終了日（ユーザー ID → YYYY-MM-DD）。 */
export function listLeaveEndDates(db: Db = getDb(), today: string = todayInJapan()): Map<string, string> {
  const rows = db
    .prepare("SELECT user_id AS userId, end_date AS endDate FROM user_absences WHERE start_date <= ? AND ? <= end_date")
    .all(today, today) as { userId: string; endDate: string }[];
  return new Map(rows.map((r) => [r.userId, r.endDate]));
}

/**
 * 登録済みで、まだ終わっていない休み（休み中と、これから始まる休み）の終了日（ユーザー ID → YYYY-MM-DD）。
 * 担当者の選択肢で、先の休みにも気づけるようにするために使う。
 */
export function listUpcomingLeaveEndDates(db: Db = getDb(), today: string = todayInJapan()): Map<string, string> {
  const rows = db
    .prepare("SELECT user_id AS userId, end_date AS endDate FROM user_absences WHERE ? <= end_date")
    .all(today) as { userId: string; endDate: string }[];
  return new Map(rows.map((r) => [r.userId, r.endDate]));
}

/** YYYY-MM-DD を「M/D」にする（先頭の 0 は付けない）。 */
export function formatMonthDay(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** 担当者の選択肢に付ける、休みの知らせ。「（休み: 11/20 まで）」。 */
export function formatLeaveNote(endDate: string): string {
  return `（休み: ${formatMonthDay(endDate)} まで）`;
}
