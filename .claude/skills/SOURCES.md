# Vendored Skills（必須）

このディレクトリの Skills は公式リポジトリから**無改変でコピー**し、コミット SHA で固定しています。
更新は `scripts/sync-skills.sh` を実行し、差分をレビューしてからコミットしてください。

| Skill | 提供元 | パス | 固定コミット | ライセンス |
|---|---|---|---|---|
| webapp-testing | anthropics/skills | `skills/webapp-testing` | `2c5958ecac7cee2b583967a2c4981d0f4a75c579` | Apache-2.0（同梱 LICENSE.txt） |
| skill-creator | anthropics/skills | `skills/skill-creator` | `2c5958ecac7cee2b583967a2c4981d0f4a75c579` | Apache-2.0（同梱 LICENSE.txt） |
| web-design-guidelines | vercel-labs/agent-skills | `skills/web-design-guidelines` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | MIT |
| gh-stack | github/gh-stack | `skills/gh-stack` | `bd0a32504f9ae9f795875a9e6bb90ff7408fda08` | MIT（リポジトリ直下の LICENSE を同梱） |
| gh | cli/cli | `skills/gh` | `736c68f674113337685e3eb1f908602a03b8f99b` | MIT（リポジトリ直下の LICENSE を同梱） |

## React / Next.js 向け（`scripts/add-stack.sh react-nextjs` で追加）

本リポジトリは PoC 用アプリが Next.js のため導入済み。React / Next.js を使わないプロジェクトでは不要。

| Skill | 提供元 | パス | 固定コミット | ライセンス |
|---|---|---|---|---|
| react-best-practices（`vercel-react-best-practices`） | vercel-labs/agent-skills | `skills/react-best-practices` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | MIT |
| composition-patterns（`vercel-composition-patterns`） | vercel-labs/agent-skills | `skills/composition-patterns` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | MIT |
| react-view-transitions（`vercel-react-view-transitions`） | vercel-labs/agent-skills | `skills/react-view-transitions` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | MIT |

更新は `scripts/add-stack.sh` 内の `VERCEL_SKILLS_REF` を変えて再実行する。

> `gh-stack` と `gh` は GitHub 公式の Skill です。`gh-stack` を使うには GitHub CLI の拡張機能 `gh extension install github/gh-stack` と、リポジトリで Stacked PRs が有効になっていることが必要です。
> 同じ cli/cli の `gh-skill`（エージェントが自分で Skill を検索・インストールする Skill）は、Skills を固定コミットで vendoring する本リポジトリの方針と合わないため導入していません。

> `web-design-guidelines` は実行時に `raw.githubusercontent.com/vercel-labs/web-interface-guidelines` から最新ルールを取得します。
> ネットワーク制限のある環境では当該ホストの許可が必要です。
