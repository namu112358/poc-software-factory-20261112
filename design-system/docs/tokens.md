# トークンと試作のモックの対応表

値の正本は `src/styles/tokens.css`。試作のモック（画面の試作。社外には出していない）の `:root` の CSS 変数を、名前を変えずに写した。Tailwind のクラスは `src/styles/globals.css` の `@theme` で、同じ名前につないでいる。

## 色

| モックの変数 | このデザインシステム | Tailwind | 明るい | 暗い | メモ |
|---|---|---|---|---|---|
| `--bg` | `--bg` | `bg-bg` など | `#ffffff` | `#191918` | |
| `--surface` | `--surface` | `bg-surface` | `#f6f5f4` | `#22211f` | |
| `--surface-soft` | `--surface-soft` | `bg-surface-soft` | `#fafaf9` | `#1e1d1c` | |
| `--hover` | `--hover` | `bg-hover` | `#f0eeec` | `#2b2a28` | |
| `--fg` | `--fg` | `text-fg` | `#1a1a1a` | `#efede9` | |
| `--fg-2` | `--fg-2` | `text-fg-2` | `#37352f` | `#dcd9d3` | |
| `--muted` | `--muted` | `text-muted` | `#5d5b54` | `#a8a49c` | |
| `--faint` | `--faint` | `text-faint` | `#787671` | `#8f8b83` | 明るい表示で `--surface` の上に置くとコントラスト 4.17。文字は `--bg` の上だけ |
| `--border` | `--border` | `border-border` | `#e5e3df` | `#34322f` | |
| `--border-strong` | `--border-strong` | `border-border-strong` | `#c8c4be` | `#4a4743` | |
| `--brand` | `--brand` | `bg-brand` | `#2563eb` | **`#356ee9`** | モックの暗い表示は `#3b74f0`。白い文字とのコントラストが 4.25 で AA（4.5）に届かないため変えた |
| `--brand-fg` | `--brand-fg` | `text-brand-fg` | `#ffffff` | `#ffffff` | |
| `--brand-soft` | `--brand-soft` | `bg-brand-soft` | `#e8effd` | `#1d2a45` | |
| `--link` | `--link` | `text-link` | `#005bab` | `#7fb0ef` | |
| `--ok` | `--ok` | `text-ok` | `#146c2e` | `#7dd99a` | |
| `--ok-soft` | `--ok-soft` | `bg-ok-soft` | `#d9f3e1` | `#173523` | |
| `--warn` | `--warn` | `text-warn` | `#793400` | `#f6b37a` | |
| `--warn-soft` | `--warn-soft` | `bg-warn-soft` | `#ffe8d4` | `#3a2614` | |
| `--warn-line` | `--warn-line` | `border-warn-line` | `#dd5b00` | `#f08a3c` | |
| `--err` | `--err` | `text-err` | `#b42318` | `#ff9a90` | |
| `--err-soft` | `--err-soft` | `bg-err-soft` | `#fde0ec` | `#3d1c1f` | |
| `--viz-now` | `--viz-now` | `bg-viz-now` | `#2b2925` | `#efede9` | |
| `--viz-next` | `--viz-next` | `bg-viz-next` | `#0f766e` | `#4bbfae` | |
| `--viz-r1`〜`--viz-r3` | 同じ | `bg-viz-r1` など | `#e8e5e0`・`#d6d0c7`・`#c4bcaf` | `#34322e`・`#46433d`・`#5a564e` | |
| `--viz-track` | `--viz-track` | `bg-viz-track` | `#f6f5f4` | `#2a2926` | |
| `--viz-prev` | `--viz-prev` | `bg-viz-prev` | `#65625b` | `#a8a49c` | |

## 形・文字

| モックの変数・値 | このデザインシステム | Tailwind |
|---|---|---|
| `--r`（8px） | `--r` | `rounded-md` |
| `--r-lg`（12px） | `--r-lg` | `rounded-lg` |
| `border-radius:999px`（タグ） | — | `rounded-full` |
| `--font` | `--font` | `font-sans`（`body` の既定） |
| `box-shadow: 0 8px 24px rgba(0,0,0,.12)`（浮く要素） | `--shadow` | `shadow-pop` |
| 文字 11・12・13・14・16・20px | — | `text-2xs`・`text-xs`・`text-sm`・`text-base`・`text-lg`・`text-xl` |
| 余白 4・6・8・10・12・14・16px | `--spacing: 4px` | `p-1`・`p-1.5`・`p-2`・`p-2.5`・`p-3`・`p-3.5`・`p-4` |

## 写さなかった変数

| モックの変数 | 理由 |
|---|---|
| `--side`・`--side-active` | アプリの骨組み（サイドバー）の色。`--side` は `--surface` と同じ値。骨組みの部品を作るときに決める |
| `--band-0`・`--band-1` | 特定の画面の帯の色。業務の型を作るときに決める |
| `--viz-pb0`・`--viz-pb1` | 図の中の位置（%）で、色ではない |
| `--viz-q`・`--viz-q-soft`・`--viz-q-track`・`--g-*` | 特定の図の色。図の部品（業務の型）を作るときに決める |
| `--chat-hl`・`--chat-line`・`--chat-ink` | チャットの欄の色。業務の型を作るときに決める |
| `--now-ink`・`--ib-edge` | 特定の画面の印の色。業務の型を作るときに決める |

## 明るい表示と暗い表示

- 既定は明るい表示。OS が暗い設定なら暗い表示になる（`prefers-color-scheme`）。
- `data-theme="dark"`・`data-theme="light"` を `<html>` か任意の要素に付けると、その中を固定できる。モックと同じ仕組み。
