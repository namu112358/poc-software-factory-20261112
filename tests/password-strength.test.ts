import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePasswordStrength, passwordStrengthText } from "../src/lib/password-strength.ts";

test("12 文字以上で 3 種類以上なら強い", () => {
  assert.equal(evaluatePasswordStrength("Abcdefgh1234"), "strong");
  assert.equal(passwordStrengthText("Abcdefgh1234"), "強さ: 強い");
});

test("8 文字以上で 2 種類以上なら普通", () => {
  assert.equal(evaluatePasswordStrength("abcdefg1"), "normal");
  // 12 文字以上でも 2 種類なら普通
  assert.equal(evaluatePasswordStrength("abcdefghij12"), "normal");
});

test("それ以外は弱い", () => {
  assert.equal(evaluatePasswordStrength("abcdefgh"), "weak");
  assert.equal(evaluatePasswordStrength("Ab1!"), "weak");
  assert.equal(passwordStrengthText("abc"), "強さ: 弱い");
});

test("境界: 11 文字・3 種類は普通、記号も 1 種類に数える", () => {
  assert.equal(evaluatePasswordStrength("Abcdefgh12!"), "normal");
  assert.equal(evaluatePasswordStrength("abcdefgh1!"), "normal");
  assert.equal(evaluatePasswordStrength("Abcdefghij1!"), "strong");
});

test("空のときは何も表示しない", () => {
  assert.equal(passwordStrengthText(""), undefined);
});
