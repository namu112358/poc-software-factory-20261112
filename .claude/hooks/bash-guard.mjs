#!/usr/bin/env node
// PreToolUse（Bash）のフック。
// 役目: Routine が承認の画面で止まらないように、止まりやすい形を実行前に断り、分け方を返すこと。
// 守りの境界ではない。何を実行してよいかの境界は `.claude/settings.json` の許可（`permissions.allow`）で決める。
// 作り方: コマンドは解析しない。次の 2 つだけを見る。
//   1. 文字の許可リスト: `;` `&` `<` `>` `$` バッククォート `\` `(` `)` `{` `}` 改行 が 1 つでもあれば断る（引用符の中かどうかは区別しない。区別すると解析のずれが生まれるため）。
//   2. `|` は、`head`・`tail`・`grep`・`wc`・`sort` に渡す形だけ通す。
//   文字では捕まらない 2 つだけは単語で見る: 先頭の `NAME=value` の前置きと、git の `-c`・`--config-env`・`--exec-path`・`--git-dir`・`--work-tree`。
// 断った理由は permissionDecisionReason でエージェントに返る（Claude Code のフックの仕様: 終了コード 0 と JSON の出力）。
// 判定は check() に置き、tests/bash-guard.test.ts で確かめる。

const BANNED = /[;&<>$`\\(){}\n\r]/;
const PIPE_SINKS = new Set(["head", "tail", "grep", "wc", "sort"]);
const GIT_BANNED_OPTS = ["--config-env", "--exec-path", "--git-dir", "--work-tree"];

const SPLIT =
  "1 回に 1 コマンドにしてください。複数の手順の確かめは、Write でスクラッチパッドにスクリプト（.mjs など）を書き、`node <ファイル>` で 1 コマンドで実行します。サーバーは Bash の run_in_background で 1 コマンドで起動します。`git commit -m` で書けない本文は、Write でファイルに書いて `git commit -F <ファイル>` で渡します。一時のフォルダーは消さずに新しい名前で作ります。git は `git -C <ディレクトリ>` で実行します。";

const deny = (what) => ({ deny: true, reason: `${what}は、承認の画面で止まりやすいので実行しません。${SPLIT}` });

/** git の全体のオプション（サブコマンドの前）に、設定やパスを差し替えるものがあるか */
function hasBannedGitOption(words) {
  if (words[0]?.split("/").pop() !== "git") return false;
  for (let i = 1; i < words.length && words[i].startsWith("-"); i++) {
    const w = words[i];
    if (w === "-c" || GIT_BANNED_OPTS.some((o) => w === o || w.startsWith(`${o}=`))) return true;
    if (w === "-C") i++; // -C の値は読み飛ばす
  }
  return false;
}

/**
 * @param {string} command
 * @returns {{ deny: boolean, reason: string }}
 */
export function check(command) {
  const cmd = String(command ?? "");

  if (BANNED.test(cmd)) {
    return deny("`;` `&` `<` `>` `$` バッククォート `\\` `(` `)` `{` `}` 改行のどれかを含む形（つなぎ・裏での実行・リダイレクト・変数の展開・ヒアドキュメントなど）");
  }

  const segments = cmd.split("|").map((s) => s.trim().split(/\s+/).filter(Boolean));
  for (const [i, words] of segments.entries()) {
    if (words.length === 0) return deny("空のコマンドをつなぐ `|`（`||` を含む）");
    if (i > 0 && !PIPE_SINKS.has(words[0])) return deny("`head`・`tail`・`grep`・`wc`・`sort` 以外へのパイプ");
    if (/^[A-Za-z_]\w*=/.test(words[0])) return deny("コマンドの前の `NAME=value` の前置き");
    if (hasBannedGitOption(words)) return deny("git の `-c`・`--config-env`・`--exec-path`・`--git-dir`・`--work-tree`");
  }
  return { deny: false, reason: "" };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // 読めない入力は判定しない（通常の権限の確かめに任せる）
  }
  if (input?.tool_name !== "Bash") return;
  const r = check(input?.tool_input?.command);
  if (!r.deny) return;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r.reason } }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0));
}
