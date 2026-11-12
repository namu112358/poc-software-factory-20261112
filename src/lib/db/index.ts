// SQLite（Node 標準の node:sqlite）による DB 層。
// - アプリからは getDb() で共有の接続を使う。接続先は環境変数 DATABASE_PATH（既定は ":memory:"。
//   プロセスを起動するたびに初期データから始まる）。
// - テストでは openDb(":memory:") で独立した DB を作り、各関数の引数 db に渡す。
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./migrations.ts";
import { hashPassword } from "../password.ts";
import { SEED_PASSWORD, SEED_TASKS, SEED_USERS } from "./seed.ts";

export type Db = DatabaseSync;

export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): void {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (const m of migrations) {
    if (m.version <= current) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${Number(m.version)}`);
    });
  }
}

export function seed(db: Db): void {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (n > 0) return;
  transaction(db, () => {
    const insertUser = db.prepare("INSERT INTO users (id, name, password_hash) VALUES (?, ?, ?)");
    for (const u of SEED_USERS) insertUser.run(u.id, u.name, hashPassword(SEED_PASSWORD));
    const insertTask = db.prepare("INSERT INTO tasks (title, status, assignee, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    const now = new Date().toISOString();
    for (const t of SEED_TASKS) insertTask.run(t.title, t.status, t.assignee, t.dueDate, now, now);
  });
}

/** DB を開き、マイグレーションと初期データの投入まで行う。 */
export function openDb(path: string = ":memory:", options: { seed?: boolean } = {}): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  if (options.seed ?? true) seed(db);
  return db;
}

/** fn を 1 つのトランザクションで実行する。例外が出たらロールバックして投げ直す。 */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// 開発サーバーの再読み込みで接続が増えないよう、globalThis に保持する。
const globalForDb = globalThis as unknown as { __pocDb?: Db };

export function getDb(): Db {
  globalForDb.__pocDb ??= openDb(process.env.DATABASE_PATH || ":memory:");
  return globalForDb.__pocDb;
}
