// タスクを作る・直すフォームの誤りの文を、どの欄の誤りかに対応づける。
// API の応答（文と状態コード）は変えず、画面に出す文と欄への結び付けだけをここで決める。

export type TaskFormField = "title" | "assignee" | "dueDate" | "status" | "priority" | "memo";

export type FormErrorItem = { message: string; field?: TaskFormField };

/** 期限が空のときに画面に出す文（API の文は形式の誤りを指すので、日付を選ぶ欄では分かりにくい）。 */
export const DUE_DATE_EMPTY_MESSAGE = "期限を選んでください";

const FIELD_BY_MESSAGE_PREFIX: [string, TaskFormField][] = [
  ["タイトル", "title"],
  ["担当者", "assignee"],
  ["期限は", "dueDate"],
  ["ステータス", "status"],
  ["優先度", "priority"],
  ["メモ", "memo"],
];

/** 入力した値を見て、API が返した誤りの文を、画面に出す文と対応する欄にする。対応する欄が無い文は field なし。 */
export function toFormErrorItems(messages: string[], values: { dueDate: string }): FormErrorItem[] {
  return messages.map((message) => {
    const hit = FIELD_BY_MESSAGE_PREFIX.find(([prefix]) => message.startsWith(prefix));
    const field = hit?.[1];
    if (field === "dueDate" && values.dueDate === "") return { message: DUE_DATE_EMPTY_MESSAGE, field };
    return field ? { message, field } : { message };
  });
}

/** 欄の誤りの文の要素 ID（フォームごとの接頭辞つき）。 */
export function fieldErrorId(prefix: string, field: TaskFormField): string {
  return `${prefix}-error-${field}`;
}

/** 欄に付ける誤りの属性。誤りが無ければ空。 */
export function fieldErrorProps(
  items: FormErrorItem[],
  prefix: string,
  field: TaskFormField,
): { "aria-invalid"?: true; "aria-describedby"?: string } {
  const hasError = items.some((i) => i.field === field);
  return hasError ? { "aria-invalid": true, "aria-describedby": fieldErrorId(prefix, field) } : {};
}

/** 欄ごとの誤りの文（同じ欄に複数あれば読点でつなぐ）。 */
export function fieldErrorText(items: FormErrorItem[], field: TaskFormField): string {
  return items.filter((i) => i.field === field).map((i) => i.message).join("、");
}
