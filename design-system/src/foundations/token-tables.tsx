/** トークンの見本のページで使う表。値は CSS 変数から読むので、表示の切り替えに合わせて変わる。 */

type ColorToken = { name: string; use: string };

export const colorGroups: { title: string; tokens: ColorToken[] }[] = [
  {
    title: "面",
    tokens: [
      { name: "bg", use: "画面の地" },
      { name: "surface", use: "一段下げた面（帯・タグの地）" },
      { name: "surface-soft", use: "ごく薄い面（注記の箱）" },
      { name: "hover", use: "ポインターを乗せたとき" },
    ],
  },
  {
    title: "文字",
    tokens: [
      { name: "fg", use: "本文" },
      { name: "fg-2", use: "本文より一段弱い文字" },
      { name: "muted", use: "補足・表の見出し" },
      { name: "faint", use: "ごく弱い文字（bg の上だけ。surface の上ではコントラストが足りない）" },
      { name: "link", use: "リンク・控えめなボタン" },
    ],
  },
  {
    title: "線",
    tokens: [
      { name: "border", use: "区切り線・枠" },
      { name: "border-strong", use: "入力欄・ふつうのボタンの枠" },
    ],
  },
  {
    title: "ブランド",
    tokens: [
      { name: "brand", use: "主な操作・フォーカス・選択中だけ" },
      { name: "brand-fg", use: "brand の上の文字" },
      { name: "brand-soft", use: "選択中の地" },
    ],
  },
  {
    title: "状態",
    tokens: [
      { name: "ok", use: "済み・確定" },
      { name: "ok-soft", use: "ok の地" },
      { name: "warn", use: "見込み・注意" },
      { name: "warn-soft", use: "warn の地" },
      { name: "warn-line", use: "注意の線" },
      { name: "err", use: "誤り・遅れ" },
      { name: "err-soft", use: "err の地" },
    ],
  },
  {
    title: "図",
    tokens: [
      { name: "viz-now", use: "このままの値・今回の見込み" },
      { name: "viz-next", use: "対策・予定を入れた値" },
      { name: "viz-r1", use: "段（下）" },
      { name: "viz-r2", use: "段（中）" },
      { name: "viz-r3", use: "段（上）" },
      { name: "viz-track", use: "棒の溝" },
      { name: "viz-prev", use: "前回の値" },
    ],
  },
];

export function ColorTable({ tokens }: { tokens: ColorToken[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="border-b border-border px-2.5 py-2 font-medium">明るい</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">暗い</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">CSS 変数</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">Tailwind</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">使う場面</th>
        </tr>
      </thead>
      <tbody>
        {tokens.map((t) => (
          <tr key={t.name}>
            {(["light", "dark"] as const).map((theme) => (
              <td key={theme} className="border-b border-border px-2.5 py-2">
                <span data-theme={theme} className="block w-fit rounded-md bg-bg p-1">
                  <span
                    className="block h-6 w-12 rounded-md border border-border"
                    style={{ background: `var(--${t.name})` }}
                    aria-hidden="true"
                  />
                </span>
              </td>
            ))}
            <td className="border-b border-border px-2.5 py-2">
              <code>--{t.name}</code>
            </td>
            <td className="border-b border-border px-2.5 py-2">
              <code>bg-{t.name}</code>、<code>text-{t.name}</code>、<code>border-{t.name}</code>
            </td>
            <td className="border-b border-border px-2.5 py-2">{t.use}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const textSteps = [
  { cls: "text-2xs", px: "11px", use: "ごく小さい注記（タグの中の補足）" },
  { cls: "text-xs", px: "12px", use: "タグ・表の見出し・補足" },
  { cls: "text-sm", px: "13px", use: "小さいボタン・説明文" },
  { cls: "text-base", px: "14px", use: "本文・ボタン・入力欄（既定）" },
  { cls: "text-lg", px: "16px", use: "区切りの見出し（h2）" },
  { cls: "text-xl", px: "20px", use: "画面の見出し（h1）" },
];

export function TextTable() {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="border-b border-border px-2.5 py-2 font-medium">Tailwind</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">大きさ</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">見本</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">使う場面</th>
        </tr>
      </thead>
      <tbody>
        {textSteps.map((s) => (
          <tr key={s.cls}>
            <td className="border-b border-border px-2.5 py-2">
              <code>{s.cls}</code>
            </td>
            <td className="border-b border-border px-2.5 py-2">{s.px}</td>
            <td className={`border-b border-border px-2.5 py-2 ${s.cls}`}>申請の書類をそろえる</td>
            <td className="border-b border-border px-2.5 py-2">{s.use}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const spaceSteps = [
  { cls: "1", px: 4 },
  { cls: "1.5", px: 6 },
  { cls: "2", px: 8 },
  { cls: "2.5", px: 10 },
  { cls: "3", px: 12 },
  { cls: "3.5", px: 14 },
  { cls: "4", px: 16 },
  { cls: "6", px: 24 },
];

export function SpaceTable() {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="border-b border-border px-2.5 py-2 font-medium">Tailwind の段</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">大きさ</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">見本</th>
        </tr>
      </thead>
      <tbody>
        {spaceSteps.map((s) => (
          <tr key={s.cls}>
            <td className="border-b border-border px-2.5 py-2">
              <code>p-{s.cls}</code>、<code>gap-{s.cls}</code>
            </td>
            <td className="border-b border-border px-2.5 py-2">{s.px}px</td>
            <td className="border-b border-border px-2.5 py-2">
              <span className="block h-3 bg-brand" style={{ width: s.px }} aria-hidden="true" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const radiusSteps = [
  { cls: "rounded-md", v: "--r", px: "8px", use: "ボタン・入力欄" },
  { cls: "rounded-lg", v: "--r-lg", px: "12px", use: "枠で囲んだ区切り（パネル）" },
  { cls: "rounded-full", v: "—", px: "9999px", use: "タグ・バッジ" },
];

export function RadiusTable() {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="border-b border-border px-2.5 py-2 font-medium">Tailwind</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">CSS 変数</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">大きさ</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">見本</th>
          <th className="border-b border-border px-2.5 py-2 font-medium">使う場面</th>
        </tr>
      </thead>
      <tbody>
        {radiusSteps.map((s) => (
          <tr key={s.cls}>
            <td className="border-b border-border px-2.5 py-2">
              <code>{s.cls}</code>
            </td>
            <td className="border-b border-border px-2.5 py-2">
              <code>{s.v}</code>
            </td>
            <td className="border-b border-border px-2.5 py-2">{s.px}</td>
            <td className="border-b border-border px-2.5 py-2">
              <span className={`block h-6 w-12 border border-border-strong bg-surface ${s.cls}`} aria-hidden="true" />
            </td>
            <td className="border-b border-border px-2.5 py-2">{s.use}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
