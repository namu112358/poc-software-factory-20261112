/** 狭い画面（スマートフォン）の幅の上限（px）。これより狭いときだけ、押せる範囲を広げる。 */
export const NARROW_MAX_WIDTH = 599;

/** 指で押せる大きさの下限（px）。 */
export const TOUCH_TARGET_PX = 44;

/**
 * 狭い画面で、ボタン・リンク・入力欄・select・チェックボックスを指で押しやすくする CSS。
 * リンクは、ナビ・表・リストの中と、段落にそれだけで置かれたもの・フォームの直下のものを広げる（文中のリンクは対象外）。
 * 広い画面には効かない。フォーカスの枠は変えない。
 */
export const TOUCH_CSS = `@media (max-width:${NARROW_MAX_WIDTH}px){` +
  `button,input:not([type=checkbox]):not([type=radio]),select,textarea{font-size:16px;min-height:${TOUCH_TARGET_PX}px;min-width:${TOUCH_TARGET_PX}px;box-sizing:border-box}` +
  `input[type=checkbox],input[type=radio]{width:${TOUCH_TARGET_PX}px;height:${TOUCH_TARGET_PX}px;margin:0}` +
  `nav a,td a,th a,li a,p>a:only-child,form>a{display:inline-flex;align-items:center;min-height:${TOUCH_TARGET_PX}px;min-width:${TOUCH_TARGET_PX}px}` +
  `header{gap:12px 12px!important}` +
  `}`;
