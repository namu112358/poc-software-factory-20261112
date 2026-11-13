# デザインシステム（見本）

業務アプリの画面で使う部品を、Storybook で見ながら作るためのライブラリです。本採用は決まっておらず、Software Factory の PoC で部品を作らせる見本として置いています。タスク管理アプリ（リポジトリの直下）とは別の npm プロジェクトです。

公開先: https://namu112358.github.io/poc-software-factory-20261112/ （`main` の Storybook。マージの後、数分で更新される）

## 使い方

```bash
cd design-system
npm ci
npm run storybook   # http://localhost:6006 で部品を見る
```

| コマンド | すること |
|---|---|
| `npm run typecheck` | 型チェック |
| `npm run lint` | 部品にトークン以外の色・任意の値が書かれていないかを確かめる |
| `npm test` | Stories をテストとして Chromium で動かす（play の確かめと axe の検査） |
| `npm run build` | Storybook を `storybook-static/` に書き出す |

`npm test` は Playwright の Chromium を使います。入っていなければ `npx playwright install chromium` を一度実行してください。

## 中身

- `src/styles/tokens.css` — トークン（色・角丸・書体）の値の正本。明るい表示と暗い表示。
- `src/styles/globals.css` — Tailwind v4 のテーマを、トークンだけに絞る。
- `src/components/<名前>/` — 部品。`<名前>.tsx`・`<名前>.stories.tsx`・`<名前>.mdx`（Docs）の 3 つをそろえる。手本は `button/`。
- `src/foundations/` — トークンの見本のページ。
- `docs/tokens.md` — 試作のモックの変数との対応表。

## 作り方の決まり

部品は shadcn/ui の作り方に従います（`cva` で見た目の種類を決め、`cn` でクラスをまとめ、`data-slot` を付け、振る舞いのある部品は Radix のプリミティブを包む）。規約は、リポジトリの `AGENTS.md` の「design-system/」の節を読んでください。
