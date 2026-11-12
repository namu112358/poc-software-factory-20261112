import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CAPS_LOCK_MESSAGE, isCapsLockOn } from "../src/lib/caps-lock.ts";

describe("Caps Lock の判定", () => {
  it("Caps Lock がオンなら true を返す", () => {
    assert.equal(isCapsLockOn({ getModifierState: (k) => k === "CapsLock" }), true);
  });
  it("Caps Lock がオフなら false を返す", () => {
    assert.equal(isCapsLockOn({ getModifierState: () => false }), false);
  });
  it("状態を読み取れなければ false を返す", () => {
    assert.equal(isCapsLockOn({}), false);
  });
  it("表示する文言は「Caps Lock がオンです」", () => {
    assert.equal(CAPS_LOCK_MESSAGE, "Caps Lock がオンです");
  });
});
