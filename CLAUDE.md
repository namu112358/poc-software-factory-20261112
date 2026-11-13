# CLAUDE.md

@AGENTS.md

@docs/github-writing.md

## Claude Code に固有の事項

<!-- Claude Code だけに関わる事項（Skills・プラグイン・フックの扱いなど）を書く。どのエージェントにも関わる規約は AGENTS.md に書き、ここに重ねて書かない。 -->

- 画面を新しく作るとき・見た目や使い勝手を変えるときは、最初に `impeccable` Skill を使う。画面の変更のレビューには、必要に応じて `web-design-guidelines` Skill を使う。
  - `impeccable` Skill が環境に入っていない（`.claude/skills/` に無い）ときは、使わずに進め、見た目は既存の画面（`design-system/` ではトークンと `design-system/docs/tokens.md`）に合わせ、レビューに `web-design-guidelines` Skill を使う。
  - 理由: Skill は依頼文だけでは呼ばれないことが多く、使う Skill を書いておくと毎回呼ばれる。PoC で人が画面を比べた評価では、Impeccable で作った画面が最もよく選ばれた（標準を配るリポジトリの PoC U1・U2）。
