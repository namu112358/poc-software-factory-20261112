import { randomInt } from "node:crypto";
import { getDb, transaction, type Db } from "./db/index.ts";
import { hashPassword } from "./password.ts";
import { unknownFieldErrors } from "./body-fields.ts";
import type { ValidationResult } from "./task-types.ts";
import { isUserRole, type UserRole } from "./user-role.ts";

export { USER_ROLE_LABELS, USER_ROLES, isUserRole, type UserRole } from "./user-role.ts";

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

export type UserListItem = UserSummary & { role: UserRole };

/** 利用者の全員と、ログインを停止しているか・役割（GET /api/users。役割は #524）。並びは ID 順。 */
export function listUserSummaries(db: Db = getDb()): UserListItem[] {
  const rows = db.prepare("SELECT id, name, suspended_at, role FROM users ORDER BY id").all() as {
    id: string;
    name: string;
    suspended_at: string | null;
    role: string;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, suspended: r.suspended_at !== null, role: toRole(r.role) }));
}

function toRole(value: string | undefined): UserRole {
  return value === "coordinator" ? "coordinator" : "member";
}

/** 利用者の役割。見つからない ID は undefined。 */
export function getUserRole(userId: string, db: Db = getDb()): UserRole | undefined {
  const row = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
  return row ? toRole(row.role) : undefined;
}

/** 利用者が担当の、未完了・アーカイブしていない・削除していないタスクの件数（停止した後に残ったタスクの案内に使う。#538）。 */
export function countOpenTasksOf(userId: string, db: Db = getDb()): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee = ? AND status <> 'done' AND archived = 0 AND deleted_at IS NULL")
    .get(userId) as { n: number };
  return row.n;
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

/** 停止・再開の応答の形（id・name・suspended）。役割は含めない（#524 で GET /api/users にだけ足した）。 */
function summary(userId: string, db: Db): UserSummary {
  const { id, name, suspended } = listUserSummaries(db).find((u) => u.id === userId)!;
  return { id, name, suspended };
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

// ---- 役割の付け替え（#524） ----

/** 役割の変更を断った理由。forbidden は 403、invalid は 400（errors を details に）、not_found は 404、suspended と last_coordinator は 409 にする。 */
export type RoleChangeRefusal = "forbidden" | "invalid" | "not_found" | "suspended" | "last_coordinator";

export const ROLE_CHANGE_REFUSAL_MESSAGES: Record<RoleChangeRefusal, string> = {
  forbidden: "役割を替えられるのは、取りまとめる人だけです",
  invalid: "入力内容に誤りがあります",
  not_found: "利用者が見つかりません",
  suspended: "ログインを停止しているメンバーは、取りまとめる人にできません。先にログインを再開してください",
  last_coordinator: "取りまとめる人が 1 人もいなくなるため、メンバーに戻せません。先にほかのメンバーを取りまとめる人にしてください",
};

/** 役割の変更の本文（`{ role }`）を検証する。 */
export function validateRoleInput(body: unknown): ValidationResult<{ role: UserRole }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません。{ \"role\": \"coordinator\" } か { \"role\": \"member\" } の JSON で送ってください"] };
  }
  const { role } = body as Record<string, unknown>;
  const errors: string[] = unknownFieldErrors(body as Record<string, unknown>, ["role"]);
  if (!isUserRole(role)) errors.push("役割（role）は \"coordinator\"（取りまとめる人）か \"member\"（メンバー）にしてください");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { role: role as UserRole } };
}

export type RoleChangeResult =
  | { ok: true; user: { id: string; name: string; role: UserRole } }
  | { ok: false; reason: Exclude<RoleChangeRefusal, "invalid"> }
  | { ok: false; reason: "invalid"; errors: string[] };

/**
 * 取りまとめる人（actorId）が、利用者（targetId）の役割を替える（PUT /api/users/:id/role の判定。#524）。
 * 判定の順: 操作する人が停止していない取りまとめる人でなければ forbidden（入力によらない）、本文の誤りは invalid、
 * 相手がいなければ not_found、今と同じ役割なら何も変えずに成功、停止中の人を取りまとめる人にするなら suspended、
 * メンバーに戻すと停止していない取りまとめる人が 0 人になるなら last_coordinator。
 * 数えるのも書き込むのも 1 つのトランザクションの中で行う（同時に自分を戻しても、最後の 1 人は残る）。
 * 役割は要求のたびに DB から読むので（isCoordinator）、替えた次の要求から、延長の承認などができる人が変わる。
 */
export function changeUserRole(actorId: string, targetId: string, body: unknown, db: Db = getDb()): RoleChangeResult {
  return transaction(db, (): RoleChangeResult => {
    if (!canManage(actorId, db)) return { ok: false, reason: "forbidden" };
    const input = validateRoleInput(body);
    if (!input.ok) return { ok: false, reason: "invalid", errors: input.errors };
    const target = getUser(targetId, db);
    if (!target) return { ok: false, reason: "not_found" };
    const { role } = input.value;
    const result = { ok: true as const, user: { id: target.id, name: target.name, role } };
    if (getUserRole(targetId, db) === role) return result;
    if (role === "coordinator" && isSuspended(targetId, db)) return { ok: false, reason: "suspended" };
    if (role === "member") {
      const others = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'coordinator' AND suspended_at IS NULL AND id <> ?")
        .get(targetId) as { n: number };
      if (others.n === 0) return { ok: false, reason: "last_coordinator" };
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, targetId);
    return result;
  });
}

// ---- メンバーのアカウントの作成と、仮のパスワード（#523） ----

/** ID の決まり: 英小文字・数字・`-`・`_` だけで、3〜32 文字、先頭は英小文字。大文字は小文字にそろえず断る。 */
export const USER_ID_MIN_LENGTH = 3;
export const USER_ID_MAX_LENGTH = 32;
const USER_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
/** 名前の決まり: 前後の空白を除いて 1〜50 文字（見た目の文字（コードポイント）で数える）。改行・制御文字は使えない。 */
export const USER_NAME_MAX_LENGTH = 50;
const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/u;

export type NewMemberInput = { userId: string; name: string };

/** アカウントの作成の本文（`{ userId, name }`）を検証する。名前は前後の空白を除いた値にする。誤りは、何が悪いかとどう直すかの文言。 */
export function validateNewMemberInput(body: unknown): ValidationResult<NewMemberInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["リクエストの形式が正しくありません。{ \"userId\": ..., \"name\": ... } の JSON で送ってください"] };
  }
  const { userId, name } = body as Record<string, unknown>;
  const errors: string[] = unknownFieldErrors(body as Record<string, unknown>, ["userId", "name"]);
  if (typeof userId !== "string" || userId === "") {
    errors.push("ID を入力してください");
  } else if (userId.length < USER_ID_MIN_LENGTH || userId.length > USER_ID_MAX_LENGTH) {
    errors.push(`ID は ${USER_ID_MIN_LENGTH}〜${USER_ID_MAX_LENGTH} 文字にしてください（今は ${[...userId].length} 文字）`);
  } else if (!USER_ID_PATTERN.test(userId)) {
    errors.push("ID に使えない文字があります。英小文字・数字・「-」・「_」だけを使い、先頭は英小文字にしてください（大文字は小文字に直してください）");
  }
  const trimmed = typeof name === "string" ? name.trim() : undefined;
  if (trimmed === undefined || trimmed === "") {
    errors.push("名前を入力してください");
  } else if (CONTROL_CHARS.test(trimmed)) {
    errors.push("名前に改行や制御文字は使えません。1 行の文字だけにしてください");
  } else if ([...trimmed].length > USER_NAME_MAX_LENGTH) {
    errors.push(`名前は ${USER_NAME_MAX_LENGTH} 文字以内にしてください（今は ${[...trimmed].length} 文字）`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { userId: userId as string, name: trimmed as string } };
}

/** 仮のパスワードの文字数。推測しにくい長さ（16 文字以上）にする。 */
export const TEMPORARY_PASSWORD_LENGTH = 20;
// 読み間違えやすい文字（0・O・o・1・l・I）を除いた英数字。
const TEMPORARY_PASSWORD_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 仮のパスワードを作る（暗号用の乱数で、偏りなく文字を選ぶ）。 */
export function generateTemporaryPassword(): string {
  let out = "";
  for (let i = 0; i < TEMPORARY_PASSWORD_LENGTH; i++) out += TEMPORARY_PASSWORD_CHARS[randomInt(TEMPORARY_PASSWORD_CHARS.length)];
  return out;
}

/** 作成を断った理由。forbidden は 403、invalid は 400（errors を details に）、conflict は 409 にする。 */
export type CreateMemberRefusal = "forbidden" | "invalid" | "conflict";

export const CREATE_MEMBER_REFUSAL_MESSAGES: Record<CreateMemberRefusal, string> = {
  forbidden: "メンバーを加えられるのは、取りまとめる人だけです",
  invalid: "入力内容に誤りがあります",
  conflict: "その ID はすでに使われています",
};

export type CreatedMember = { id: string; name: string; role: "member" };

export type CreateMemberResult =
  | { ok: true; user: CreatedMember; temporaryPassword: string }
  | { ok: false; reason: "forbidden" | "conflict" }
  | { ok: false; reason: "invalid"; errors: string[] };

/**
 * 取りまとめる人（actorId）が、メンバーのアカウントを作る（POST /api/users の判定。#523）。役割はメンバー。
 * 判定の順: 操作する人が停止していない取りまとめる人でなければ forbidden（入力によらない）、本文の誤りは invalid、
 * ID がすでにある（停止中を含む）なら conflict。断ったときは何も作らない。
 * パスワードは仮のものを作り、ハッシュだけを保存して、平文は戻り値でだけ返す（あとから取り出せない）。
 * 作ったアカウントは、本人がパスワードを変えるまで、ほかの画面と API を使えない（must_change_password）。
 */
export function createMember(actorId: string, body: unknown, db: Db = getDb()): CreateMemberResult {
  return transaction(db, (): CreateMemberResult => {
    if (!canManage(actorId, db)) return { ok: false, reason: "forbidden" };
    const input = validateNewMemberInput(body);
    if (!input.ok) return { ok: false, reason: "invalid", errors: input.errors };
    const { userId, name } = input.value;
    if (getUser(userId, db)) return { ok: false, reason: "conflict" };
    const temporaryPassword = generateTemporaryPassword();
    db.prepare(
      "INSERT INTO users (id, name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'member', 1)",
    ).run(userId, name, hashPassword(temporaryPassword));
    return { ok: true, user: { id: userId, name, role: "member" }, temporaryPassword };
  });
}

/** 仮のパスワードのままで、自分のパスワードへの変更が要る利用者か。見つからない ID は false。 */
export function mustChangePassword(userId: string, db: Db = getDb()): boolean {
  const row = db.prepare("SELECT must_change_password FROM users WHERE id = ?").get(userId) as
    | { must_change_password: number }
    | undefined;
  return row?.must_change_password === 1;
}

/** 仮のパスワードの間に、ほかの画面・API を断るときの文言。 */
export const PASSWORD_CHANGE_REQUIRED_MESSAGE = "仮のパスワードでログインしています。パスワードを変更するまで、ほかの画面と操作は使えません";
export const PASSWORD_CHANGE_REQUIRED_DETAIL = "パスワード変更の画面（/settings/password）か POST /api/password で、自分のパスワードに変えてください";
