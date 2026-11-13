import { getDb, transaction, type Db } from "./db/index.ts";

export type User = { id: string; name: string };

/** 利用者の全員（停止した人を含む）。過去の記録の名前・一覧の絞り込みに使う。 */
export function listUsers(db: Db = getDb()): User[] {
  return db.prepare("SELECT id, name FROM users ORDER BY id").all() as User[];
}

/** 利用者（停止した人を含む）。見つからなければ undefined。 */
export function getUser(id: string, db: Db = getDb()): User | undefined {
  return db.prepare("SELECT id, name FROM users WHERE id = ?").get(id) as User | undefined;
}

/**
 * 担当者の候補として返す形（id と name だけ）。ほかの項目が混ざっても外へ出さない。
 * ログインを停止した利用者は含めない（担当者にできないため。#522）。
 */
export function listUserOptions(db: Db = getDb()): User[] {
  return (db.prepare("SELECT id, name FROM users WHERE suspended_at IS NULL ORDER BY id").all() as User[]).map(
    ({ id, name }) => ({ id, name }),
  );
}

export type UserSummary = User & { suspended: boolean };

/** 利用者の全員と、ログインを停止しているか（GET /api/users）。並びは ID 順。 */
export function listUserSummaries(db: Db = getDb()): UserSummary[] {
  const rows = db.prepare("SELECT id, name, suspended_at FROM users ORDER BY id").all() as {
    id: string;
    name: string;
    suspended_at: string | null;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, suspended: r.suspended_at !== null }));
}

/** ログインを停止している利用者か。見つからない ID は false。 */
export function isSuspended(userId: string, db: Db = getDb()): boolean {
  const row = db.prepare("SELECT suspended_at FROM users WHERE id = ?").get(userId) as { suspended_at: string | null } | undefined;
  return row !== undefined && row.suspended_at !== null;
}

/** 担当者にできる利用者か（いて、ログインを停止していない）。 */
export function isAssignableUser(userId: unknown, db: Db = getDb()): boolean {
  return (
    typeof userId === "string" &&
    db.prepare("SELECT 1 FROM users WHERE id = ? AND suspended_at IS NULL").get(userId) !== undefined
  );
}

/** 取りまとめる人（role が coordinator）か。延長の申請を承認・却下できるのは取りまとめる人だけ。見つからない ID は false。 */
export function isCoordinator(userId: string, db: Db = getDb()): boolean {
  const row = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
  return row?.role === "coordinator";
}

/** 停止・再開を断った理由。forbidden は 403、not_found は 404、self は 400 にする。 */
export type SuspensionRefusal = "forbidden" | "not_found" | "self";

export type SuspensionResult = { ok: true; user: UserSummary } | { ok: false; reason: SuspensionRefusal };

/** 停止・再開を断るときの文言。 */
export const SUSPENSION_REFUSAL_MESSAGES: Record<SuspensionRefusal, string> = {
  forbidden: "メンバーの停止・再開ができるのは、取りまとめる人だけです",
  not_found: "利用者が見つかりません",
  self: "自分自身のログインは停止・再開できません",
};

function summary(userId: string, db: Db): UserSummary {
  return listUserSummaries(db).find((u) => u.id === userId)!;
}

/** 操作する人が、停止していない取りまとめる人か。 */
function canManage(actorId: string, db: Db): boolean {
  return isCoordinator(actorId, db) && !isSuspended(actorId, db);
}

/**
 * 取りまとめる人（actorId）が、利用者（targetId）のログインを停止する（#522）。
 * 判定の順: 操作する人が停止していない取りまとめる人でなければ forbidden、相手がいなければ not_found、自分自身なら self。
 * 操作する人は停止していない取りまとめる人で、自分自身は停止できないので、停止しても取りまとめる人が 0 人になることはない
 * （取りまとめる人が 1 人だけのとき、その人を停止できる人はいない）。
 * 停止の記録と、相手のセッション（期限切れを含む）をすべて消すことは、1 つのトランザクションで行う。
 * すでに停止していれば何も変えずに成功を返す（停止した日時は最初のまま）。
 */
export function suspendUser(actorId: string, targetId: string, db: Db = getDb(), now: Date = new Date()): SuspensionResult {
  return transaction(db, () => {
    if (!canManage(actorId, db)) return { ok: false, reason: "forbidden" };
    if (!getUser(targetId, db)) return { ok: false, reason: "not_found" };
    if (targetId === actorId) return { ok: false, reason: "self" };
    if (isSuspended(targetId, db)) return { ok: true, user: summary(targetId, db) };
    db.prepare("UPDATE users SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL").run(now.toISOString(), targetId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
    return { ok: true, user: summary(targetId, db) };
  });
}

/**
 * 取りまとめる人（actorId）が、停止した利用者（targetId）のログインを再開する（#522）。
 * 操作する人が停止していない取りまとめる人でなければ forbidden、相手がいなければ not_found、自分自身なら self。
 * 停止していなければ何も変えずに成功を返す。
 */
export function resumeUser(actorId: string, targetId: string, db: Db = getDb()): SuspensionResult {
  return transaction(db, () => {
    if (!canManage(actorId, db)) return { ok: false, reason: "forbidden" };
    if (!getUser(targetId, db)) return { ok: false, reason: "not_found" };
    if (targetId === actorId) return { ok: false, reason: "self" };
    db.prepare("UPDATE users SET suspended_at = NULL WHERE id = ?").run(targetId);
    return { ok: true, user: summary(targetId, db) };
  });
}
