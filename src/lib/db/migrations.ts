// スキーマのマイグレーション。PRAGMA user_version で適用済みの番号を管理する。
// 既存のマイグレーションは書き換えず、変更は末尾に新しい番号で追加する。
export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "users_and_tasks",
    sql: `
      CREATE TABLE users (
        id   TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        title    TEXT NOT NULL,
        status   TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
        assignee TEXT NOT NULL REFERENCES users(id),
        due_date TEXT NOT NULL
      );
      CREATE INDEX tasks_assignee ON tasks(assignee);
    `,
  },
  {
    version: 2,
    name: "auth",
    sql: `
      ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
      CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL -- ISO 8601（UTC）
      );
      CREATE INDEX sessions_user ON sessions(user_id);
    `,
  },
];
