export type TaskStatus = "todo" | "in_progress" | "done";

export type TaskPriority = "high" | "medium" | "low";

export type Task = {
  id: number;
  title: string;
  status: TaskStatus;
  assignee: string;
  dueDate: string; // YYYY-MM-DD
  priority: TaskPriority;
  estimateMinutes: number | null; // 見積もり時間（分）。未設定は null
  createdAt: string; // ISO 8601（UTC）
  updatedAt: string; // ISO 8601（UTC）
  completedAt: string | null; // 完了にした日時。ISO 8601（UTC）。完了していなければ null
  memo: string; // メモ（詳しい説明）。0〜2000 文字。既定は空文字
  archived: boolean; // アーカイブ済みか。一覧には既定で出ない（消さずに隠す）
};

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "未着手",
  in_progress: "進行中",
  done: "完了",
};

export const TASK_PRIORITIES: readonly TaskPriority[] = ["high", "medium", "low"];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export type TaskSort = "created" | "priority" | "due";

export const TASK_SORTS: readonly TaskSort[] = ["created", "priority", "due"];

export const SORT_LABELS: Record<TaskSort, string> = {
  created: "作成順",
  priority: "優先度の高い順",
  due: "期限の近い順",
};

/** 期限の絞り込み。期限切れ・今日まで・7 日以内（どれも期限切れを含む）・期限なし。 */
export const TASK_DUE_FILTERS = ["overdue", "today", "week", "none"] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

export const DUE_FILTER_LABELS: Record<TaskDueFilter, string> = {
  overdue: "期限切れ",
  today: "今日まで",
  week: "7 日以内",
  none: "期限なし",
};

export type TaskFilter = {
  due?: TaskDueFilter; // 期限の範囲。指定なしなら期限で絞り込まない
  today?: string; // 「今日」（日本時間の YYYY-MM-DD）。省略すると今日。テストで日付を固定するための項目
  status?: TaskStatus;
  assignee?: string;
  tag?: string;
  q?: string; // キーワード。タイトルかメモに含まれるタスクだけ（英字の大文字・小文字は区別しない）
  sort?: TaskSort;
  includeArchived?: boolean; // true のときだけ、アーカイブ済みも含める
};

/** 「担当者なし」を表す絞り込みの値。 */
export const UNASSIGNED = "none";

export type Assignee = { id: string; name: string };

export type TaskInput = Omit<Task, "id" | "priority" | "estimateMinutes" | "memo" | "archived" | "createdAt" | "updatedAt" | "completedAt"> & {
  priority?: TaskPriority;
  estimateMinutes?: number | null;
  memo?: string;
  archived?: boolean;
};

export const MEMO_MAX_LENGTH = 2000;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
