import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_FAILED_MESSAGE,
  PASSWORD_MISMATCH_MESSAGE,
  checkPasswordConfirmation,
  passwordErrorMessages,
} from "../src/lib/password-form.ts";

describe("パスワード変更画面の入力の確認", () => {
  it("新しいパスワードと確認が違うと、一致しない理由を返す", () => {
    assert.equal(checkPasswordConfirmation("abcdefgh1", "abcdefgh2"), PASSWORD_MISMATCH_MESSAGE);
    assert.equal(PASSWORD_MISMATCH_MESSAGE, "確認用のパスワードが一致しません");
  });
  it("一致していれば理由を返さない", () => {
    assert.equal(checkPasswordConfirmation("abcdefgh1", "abcdefgh1"), undefined);
  });
  it("API が 400 で返した details を、そのまま理由として出す", () => {
    assert.deepEqual(
      passwordErrorMessages({ error: "入力内容に誤りがあります", details: ["今のパスワードが正しくありません"] }),
      ["今のパスワードが正しくありません"],
    );
  });
  it("details が無ければ error を出し、どちらも無ければ既定の文言にする", () => {
    assert.deepEqual(passwordErrorMessages({ error: "ログインしてください" }), ["ログインしてください"]);
    assert.deepEqual(passwordErrorMessages(undefined), [PASSWORD_FAILED_MESSAGE]);
    assert.deepEqual(passwordErrorMessages({ details: [] }), [PASSWORD_FAILED_MESSAGE]);
  });
});
