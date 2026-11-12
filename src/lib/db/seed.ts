// 初期データ。空の DB を開いたときに 1 回だけ投入する。

/** 初期ユーザー共通のパスワード（PoC の検証用。本番では使わない）。 */
export const SEED_PASSWORD = "password";
/** role: member（メンバー）・coordinator（取りまとめる人。延長の申請を承認・却下できる）。 */
export const SEED_USERS = [
  { id: "sato", name: "佐藤", role: "member" },
  { id: "suzuki", name: "鈴木", role: "member" },
  { id: "tanaka", name: "田中", role: "coordinator" },
] as const;

export const SEED_TASKS = [
  { title: "要件定義書のレビュー", status: "done", assignee: "sato", dueDate: "2026-11-02" },
  { title: "ログイン画面のデザイン", status: "in_progress", assignee: "suzuki", dueDate: "2026-11-12" },
  { title: "API 設計", status: "in_progress", assignee: "sato", dueDate: "2026-11-14" },
  { title: "DB スキーマ作成", status: "todo", assignee: "tanaka", dueDate: "2026-11-18" },
  { title: "CI の整備", status: "todo", assignee: "suzuki", dueDate: "2026-11-20" },
  { title: "E2E テストの追加", status: "todo", assignee: "sato", dueDate: "2026-11-25" },
  { title: "リリースノート作成", status: "done", assignee: "tanaka", dueDate: "2026-11-05" },
] as const;
