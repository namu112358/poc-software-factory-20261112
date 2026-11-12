import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// 保存形式: scrypt$<salt の hex>$<ハッシュの hex>
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return ["scrypt", salt.toString("hex"), scryptSync(password, salt, 32).toString("hex")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
