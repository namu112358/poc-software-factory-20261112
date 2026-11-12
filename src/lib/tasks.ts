export * from "./task-types.ts";
export * from "./task-validation.ts";
export * from "./task-store.ts";
export * from "./task-dates.ts";
export * from "./task-format.ts";

/** 一覧が 0 件のときだけ、絞り込みを解除するリンク先（クエリなしの一覧）を返す。1 件以上なら null。 */
export function clearFilterHref(taskCount: number): string | null {
  return taskCount === 0 ? "/tasks?reset=1" : null;
}
