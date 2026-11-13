#!/usr/bin/env node
// PreToolUse（Bash）のフック: 承認の画面で止まりやすい形のコマンドを、実行させずに断り、分け方を返す。
// - git をほかのコマンドと `&&`・`;`・`||` でつなぐ（`cd ... && git ...` を含む）
// - `rm -rf`（`rm -fr`・`rm -r -f` も）
// - ヒアドキュメントで python・node にスクリプトを流す
// 読むだけのパイプ（`| head`・`| grep` など）は止めない。
// 断った理由は permissionDecisionReason でエージェントに返る（Claude Code のフックの仕様: 終了コード 0 と JSON の出力）。
// 判定は check() に置き、tests/bash-guard.test.ts で確かめる。

/** 引用符の中を消す（`git commit -m "a; b"` の `;` で断らないため） */
function stripQuotes(s) {
  return s.replace(/'[^']*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""');
}

const HINT = "1 コマンドずつに分けて実行してください。git は `git -C <ディレクトリ>` かフルパスで実行し、`cd` とつながないでください。";

/**
 * @param {string} command
 * @returns {{ deny: boolean, reason: string }}
 */
export function check(command) {
  const cmd = String(command ?? "");
  const firstLine = cmd.split("\n")[0];
  const hasHeredoc = /<<-?\s*['"]?\w+['"]?/.test(firstLine);

  // ヒアドキュメントで python・node に流す（`python3 - <<'EOF'`・`node <<EOF`・`cat <<EOF | python3`）
  if (hasHeredoc && /(^|[\s|;&(])(python3?|node)(\s|$)/.test(stripQuotes(firstLine))) {
    return { deny: true, reason: `ヒアドキュメントで python・node にスクリプトを流す形は、承認の画面で止まりやすいので実行しません。スクリプトをファイルに書いてから \`python3 <ファイル>\` で実行してください。${HINT}` };
  }

  // ヒアドキュメントの本文は判定しない（本文の ; などで断らない）。それ以外は全体を見る
  const head = stripQuotes(hasHeredoc ? firstLine : cmd);

  if (/(^|[\s;&|(])rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r)\b/.test(head)) {
    return { deny: true, reason: `\`rm -rf\` は実行しません。消すファイルを 1 つずつ確かめてから \`rm <ファイル>\` で消すか、人に頼んでください。${HINT}` };
  }

  // 手元の変更を捨てる形（`git checkout ... -- <パス>`・`git checkout .`・`git restore`）。許可の `git checkout claude/*` に紛れないように
  if (/(^|[\s;&|(])git\s+(checkout\s+(.*\s)?(--(\s|$)|\.(\s|$))|restore(\s|$))/.test(head)) {
    return { deny: true, reason: `手元の変更を捨てる形（\`git checkout -- <パス>\`・\`git checkout .\`・\`git restore\`）は実行しません。捨ててよいか確かめてから、人に頼んでください。${HINT}` };
  }

  // git を含み、`&&`・`||`・`;`・改行でほかのコマンドとつないでいる
  const usesGit = /(^|[\s;&|(])git(\s|$)/.test(head);
  const chained = /&&|\|\||;|\n/.test(head);
  if (usesGit && chained) {
    return { deny: true, reason: `git をほかのコマンドとつないだ形（\`&&\`・\`;\`・\`||\`、\`cd ... && git ...\`）は、承認の画面で止まりやすいので実行しません。${HINT}` };
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
