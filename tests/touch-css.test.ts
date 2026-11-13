import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NARROW_MAX_WIDTH, TOUCH_CSS, TOUCH_TARGET_PX } from "../src/lib/touch-css.ts";

describe("狭い画面の押せる範囲（#486）", () => {
  it("すべての指定は狭い画面の条件の中だけにあり、広い画面には効かない", () => {
    assert.ok(TOUCH_CSS.startsWith(`@media (max-width:${NARROW_MAX_WIDTH}px){`));
    assert.ok(TOUCH_CSS.endsWith("}}"));
    assert.equal(TOUCH_CSS.split("@media").length, 2);
  });
  it("チェックボックスを 44px 角にし、文字を 16px にする", () => {
    assert.match(TOUCH_CSS, new RegExp(`input\\[type=checkbox\\][^{]*\\{width:${TOUCH_TARGET_PX}px;height:${TOUCH_TARGET_PX}px`));
    assert.match(TOUCH_CSS, /font-size:16px/);
  });
  it("段落にそれだけで置かれたリンクと、フォームの直下のリンクも 44px 以上にする", () => {
    const rule = TOUCH_CSS.split("}").find((r) => r.includes("nav a"));
    assert.ok(rule);
    const selectors = rule.split("{")[0].split(",");
    assert.ok(selectors.includes("p>a:only-child"));
    assert.ok(selectors.includes("form>a"));
    assert.match(rule, new RegExp(`min-height:${TOUCH_TARGET_PX}px`));
  });
  it("フォーカスの枠を消さない", () => {
    assert.doesNotMatch(TOUCH_CSS, /outline/);
  });
});

describe("狭い画面ではみ出さない（#502）", () => {
  it("入力欄・メモ欄は、画面の幅を超えて広がらない", () => {
    const rule = TOUCH_CSS.split("}").find((r) => r.includes("textarea"));
    assert.ok(rule);
    assert.match(rule, /max-width:100%/);
  });
});
