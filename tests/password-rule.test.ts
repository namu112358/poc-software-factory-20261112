import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MIN_PASSWORD_LENGTH, validatePasswordChangeInput } from "../src/lib/auth.ts";
import { passwordRuleMessage } from "../src/lib/password-rule.ts";

describe("パスワード変更画面の、新しいパスワードの決まり", () => {
  it("検証の処理と同じ最低の文字数を含む", () => {
    assert.ok(passwordRuleMessage().includes(`${MIN_PASSWORD_LENGTH} 文字以上`));
  });

  it("決まりに書いた文字数ちょうどは通り、1 文字少ないと通らない", () => {
    const ok = "a".repeat(MIN_PASSWORD_LENGTH);
    const ng = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    assert.equal(validatePasswordChangeInput({ currentPassword: "old", newPassword: ok }).ok, true);
    assert.equal(validatePasswordChangeInput({ currentPassword: "old", newPassword: ng }).ok, false);
  });
});
