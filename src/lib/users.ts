import { getDb, type Db } from "./db/index.ts";

export type User = { id: string; name: string };

export function listUsers(db: Db = getDb()): User[] {
  return db.prepare("SELECT id, name FROM users ORDER BY id").all() as User[];
}

export function getUser(id: string, db: Db = getDb()): User | undefined {
  return db.prepare("SELECT id, name FROM users WHERE id = ?").get(id) as User | undefined;
}

/** 担当者の候補として返す形（id と name だけ）。ほかの項目が混ざっても外へ出さない。 */
export function listUserOptions(db: Db = getDb()): User[] {
  return listUsers(db).map(({ id, name }) => ({ id, name }));
}

/** 取りまとめる人（role が coordinator）か。延長の申請を承認・却下できるのは取りまとめる人だけ。見つからない ID は false。 */
export function isCoordinator(userId: string, db: Db = getDb()): boolean {
  const row = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
  return row?.role === "coordinator";
}
