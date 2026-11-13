const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD 形式で、実在する日付か（2 月 30 日・うるう年でない 2 月 29 日は誤り）。期限と延長の申請の判定に共通で使う。 */
export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
