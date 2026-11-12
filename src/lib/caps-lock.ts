export const CAPS_LOCK_MESSAGE = "Caps Lock がオンです";

/** キー操作のイベントから、Caps Lock がオンかどうかを返す。読み取れなければオフ扱い。 */
export function isCapsLockOn(event: { getModifierState?: (key: "CapsLock") => boolean }): boolean {
  return typeof event.getModifierState === "function" && event.getModifierState("CapsLock") === true;
}
