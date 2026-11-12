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
  {
    version: 3,
    name: "comments",
    sql: `
      CREATE TABLE comments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author     TEXT NOT NULL REFERENCES users(id),
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL -- ISO 8601（UTC）
      );
      CREATE INDEX comments_task ON comments(task_id);
    `,
  },
  {
    version: 4,
    name: "due_date_extensions",
    sql: `
      CREATE TABLE due_date_extensions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        requester    TEXT NOT NULL REFERENCES users(id),
        new_due_date TEXT NOT NULL, -- YYYY-MM-DD
        reason       TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at   TEXT NOT NULL, -- ISO 8601（UTC）
        decided_by   TEXT REFERENCES users(id),
        decided_at   TEXT -- ISO 8601（UTC）
      );
      CREATE INDEX due_date_extensions_task ON due_date_extensions(task_id);
      CREATE UNIQUE INDEX due_date_extensions_one_pending ON due_date_extensions(task_id) WHERE status = 'pending';
    `,
  },
  {
    version: 5,
    name: "task_tags",
    sql: `
      CREATE TABLE task_tags (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        name    TEXT NOT NULL,
        UNIQUE (task_id, name)
      );
      CREATE INDEX task_tags_name ON task_tags(name);
    `,
  },
  {
    version: 6,
    name: "task_priority",
    sql: `
      ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low'));
    `,
  },
  {
    version: 7,
    name: "task_estimate_minutes",
    sql: `
      ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR (estimate_minutes BETWEEN 1 AND 10000));
    `,
  },
  {
    version: 8,
    name: "task_memo",
    sql: `
      ALTER TABLE tasks ADD COLUMN memo TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 2000);
    `,
  },
  {
    version: 9,
    name: "login_attempts",
    sql: `
      CREATE TABLE login_attempts (
        user_id      TEXT PRIMARY KEY, -- 入力された ID（存在しない ID も数える）
        failures     INTEGER NOT NULL,
        locked_until TEXT -- ISO 8601（UTC）。ロックしていなければ NULL
      );
    `,
  },
  {
    version: 10,
    name: "task_timestamps",
    sql: `
      ALTER TABLE tasks ADD COLUMN created_at TEXT NOT NULL DEFAULT ''; -- ISO 8601（UTC）
      ALTER TABLE tasks ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''; -- ISO 8601（UTC）
      UPDATE tasks SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
    `,
  },
];
