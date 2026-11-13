// 役割（取りまとめる人・メンバー）の値と呼び名（#524）。画面（クライアント）からも読むため、DB を読まない。

/** 役割。取りまとめる人（coordinator）か、メンバー（member）か。 */
export const USER_ROLES = ["coordinator", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/** 役割の画面での呼び名。 */
export const USER_ROLE_LABELS: Record<UserRole, string> = { coordinator: "取りまとめる人", member: "メンバー" };
