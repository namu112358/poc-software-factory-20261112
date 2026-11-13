#!/usr/bin/env node
// PreToolUse（Bash）のフック: 承認の画面で止まりやすい形のコマンドを、実行させずに断り、分け方を返す。
// - git をほかのコマンドと `&&`・`;`・`||` でつなぐ（`cd ... && git ...` を含む）
// - `rm -rf`（`rm -fr`・`rm -r -f` も）
// - ヒアドキュメントで python・node にスクリプトを流す
// - コマンドの種類を問わず `;`・`&&`・`||` でつなぐ、`&` で裏で動かす、シェル変数の代入・展開（`$NAME`・`$(...)`・バッククォート）
// - git diff|log|show の `--output`・`-o`、npm test|run の `--script-shell`・`--node-options`・`--<名前>=<値>`、`git checkout claude/<ブランチ>` に続く引数
// 読むだけのパイプ（`| head`・`| grep` など）は止めない。
// 断った理由は permissionDecisionReason でエージェントに返る（Claude Code のフックの仕様: 終了コード 0 と JSON の出力）。
// 判定は check() に置き、tests/bash-guard.test.ts で確かめる。

/**
 * 引用符の中を消す（`git commit -m "a; b"` の `;` で断らないため）。
 * keepDouble が true のときは、シェルが展開する二重引用符の中身（`"$X"`・`"$(...)"`）は残す。
 * 引用符の外のバックスラッシュ（`\;` など）は、次の 1 文字ごと空白にする。
 */
function mask(s, keepDouble = false) {
  let out = "";
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") {
      if (c === "'") { q = null; out += c; }
      continue;
    }
    if (q === '"') {
      if (c === "\\") { if (keepDouble) out += " "; i++; continue; }
      if (c === '"') { q = null; out += c; continue; }
      if (keepDouble) out += c;
      continue;
    }
    if (c === "\\") { out += " "; i++; continue; }
    if (c === "'" || c === '"') q = c;
    out += c;
  }
  return out;
}
const stripQuotes = (s) => mask(s);

/** `rm` に、再帰（-r・-R・--recursive）と強制（-f・--force）の両方が付いているか（並びと書き方を問わない） */
function isRecursiveForceRm(head) {
  for (const m of head.matchAll(/(?:^|[\s;&|(])rm((?:\s+-{1,2}[a-zA-Z-]+)+)/g)) {
    const flags = m[1].trim().split(/\s+/);
    const short = flags.filter((f) => /^-[a-zA-Z]+$/.test(f)).join("");
    const long = flags.filter((f) => f.startsWith("--")).map((f) => f.split("=")[0]);
    const abbrev = (full, min) => long.some((f) => f.length >= min && full.startsWith(f)); // rm は長い名前の省略（--rec・--forc）も受け付ける
    const recursive = /[rR]/.test(short) || abbrev("--recursive", 3);
    const force = /f/.test(short) || abbrev("--force", 3);
    if (recursive && force) return true;
  }
  return false;
}

const HINT = "1 コマンドずつに分けて実行してください。git は `git -C <ディレクトリ>` かフルパスで実行し、`cd` とつながないでください。";

const SPLIT = "1 回に 1 コマンドにしてください。複数の手順の確かめは、Write でスクラッチパッドにスクリプト（.mjs など）を書き、`node <ファイル>` で 1 コマンドで実行します。サーバーは Bash の run_in_background で 1 コマンドで起動します。一時のフォルダーは消さずに新しい名前で作ります。";

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

  // `bash -c '...'`・`sh -c "..."` の中身も、同じ決まりで見る（引用符を消す前に取り出す）
  for (const m of (hasHeredoc ? firstLine : cmd).matchAll(/(?:^|[\s;&|(])(?:\S*\/)?(?:ba|da|k|z)?sh\s+(?:(?:-[a-zA-Z]+|--[\w-]+)\s+)*-[a-zA-Z]*c\s+(?:\$?'([^']*)'|"((?:\\.|[^"\\])*)"|(\S+))/g)) {
    const inner = check(m[1] ?? m[2] ?? m[3] ?? "");
    if (inner.deny) return inner;
  }

  // ヒアドキュメントの本文は判定しない（本文の ; などで断らない）。それ以外は全体を見る
  const head = stripQuotes(hasHeredoc ? firstLine : cmd);

  if (isRecursiveForceRm(head)) {
    return { deny: true, reason: `\`rm -rf\` は実行しません。消すファイルを 1 つずつ確かめてから \`rm <ファイル>\` で消すか、人に頼んでください。${HINT}` };
  }

  // 手元の変更を捨てる形（`git checkout ... -- <パス>`・`git checkout .`・`git restore`・`git reset --hard`・`git clean -f`）。許可の `git checkout claude/*` に紛れないように
  if (/(^|[\s;&|(])git(\s+(-C\s+\S+|-c\s+\S+|--[\w-]+(=\S+)?|-[a-zA-Z]+))*\s+(checkout\s+(.*\s)?(--(\s|$)|\.(\s|$))|restore(\s|$)|reset\s+(.*\s)?--hard\b|clean\s+(.*\s)?(-[a-zA-Z]*f[a-zA-Z]*|--force)(\s|$))/.test(head)) {
    return { deny: true, reason: `手元の変更を捨てる形（\`git checkout -- <パス>\`・\`git checkout .\`・\`git restore\`・\`git reset --hard\`・\`git clean -f\`）は実行しません。捨ててよいか確かめてから、人に頼んでください。${HINT}` };
  }

  // git を含み、`&&`・`||`・`;`・改行でほかのコマンドとつないでいる
  const usesGit = /(^|[\s;&|(])git(\s|$)/.test(head);
  const chained = /&&|\|\||;|\n/.test(head);
  if (usesGit && chained) {
    return { deny: true, reason: `git をほかのコマンドとつないだ形（\`&&\`・\`;\`・\`||\`、\`cd ... && git ...\`）は、承認の画面で止まりやすいので実行しません。${HINT}` };
  }

  // コマンドの種類を問わず、引用符の外の `;`・`&&`・`||` でつないだ形
  if (/&&|\|\||;/.test(head)) {
    return { deny: true, reason: `コマンドを \`;\`・\`&&\`・\`||\` でつないだ形は、承認の画面で止まりやすいので実行しません。${SPLIT}` };
  }

  // 引用符の外の `&`（裏での実行）。`2>&1`・`>&2`・`&>file`・`|&` は通す
  if (/&/.test(head.replace(/\d*[<>]&(?:\d+|-)?/g, "").replace(/&>>?/g, "").replace(/\|&/g, "|"))) {
    return { deny: true, reason: `\`&\` で裏で動かす形（\`cmd &\`・\`(cmd &)\`）は、承認の画面で止まりやすいので実行しません。${SPLIT}` };
  }

  // シェル変数の展開（`$NAME`・`${...}`・`$(...)`・バッククォート）と、変数だけを代入する行（`NAME=...`）
  const expandable = mask(hasHeredoc ? firstLine : cmd, true);
  // コマンドの前の `NAME=value` の前置き（`npm_config_script_shell=sh npm run x`・`NODE_OPTIONS=... npm test`・`GIT_*=... git ...`・`env NAME=... cmd`）は、すべて断る
  if (/\$[A-Za-z_]|\$\{|\$\(|`/.test(expandable) || /(?:^|[|(\n])\s*(?:env\s+(?:-\S+\s+)*)?[A-Za-z_]\w*=/.test(head)) {
    return { deny: true, reason: `シェル変数の代入・展開と、コマンドの前の環境変数の前置き（\`NAME=...\`・\`$NAME\`・\`\${...}\`・\`$(...)\`・バッククォート）は、設定を変えられるので実行しません。値はコマンドに直接書いてください。${SPLIT}` };
  }

  // `>|`（上書きのリダイレクト）は、引数の切り出しがずれるので断る
  if (/>\|/.test(head)) {
    return { deny: true, reason: `\`>|\` は実行しません。\`>\` を使うか、出力は画面に出してください。${SPLIT}` };
  }

  // 出力先を指定する git のオプション（`git diff|log|show` の `--output`・`-o`）
  // 引数は、引用符・バックスラッシュが 1 つでもあれば断る（`"--output=x"`・`--out\put=x` で検査をすり抜けさせない）。リダイレクトは取り除いてから単語に分ける
  const src = hasHeredoc ? firstLine : cmd;
  const words = (s) => s.replace(/\d*[<>]+&?\s*[^\s<>|]*/g, " ").split(/\s+/).filter(Boolean);
  for (const m of src.matchAll(/(?:^|[\s(])git(?:\s+(?:-C\s+\S+|-c\s+\S+|--[\w-]+(?:=\S+)?|-[a-zA-Z]+))*\s+(diff|log|show|checkout)(?:\s((?:[^|\n]|(?<=>)\|)*))?/g)) {
    const args = m[2] ?? "";
    const w = words(args);
    if (/['"\\]/.test(args)) {
      return { deny: true, reason: `\`git ${m[1]}\` の引数に引用符・バックスラッシュを含む形は、オプションを確かめられないので実行しません。引用符なしで書いてください。${SPLIT}` };
    }
    if (m[1] !== "checkout" && w.some((a) => (a.startsWith("--o") && a !== "--oneline") || /^-o/.test(a))) {
      return { deny: true, reason: `\`git diff\`・\`git log\`・\`git show\` の \`--output\`（\`--outp=x\`・\`--o=x\` など省略した書き方も）・\`-o\` はファイルに書き出すので実行しません。出力は画面に出してください。${SPLIT}` };
    }
    if (m[1] === "checkout" && w[0]?.startsWith("claude/") && w.length > 1) {
      return { deny: true, reason: `\`git checkout claude/<ブランチ>\` の後ろに引数（パス）を付けた形は、ファイルを書き換えるので実行しません。ブランチの切り替えだけにしてください。${SPLIT}` };
    }
  }

  // npm の設定を変える引数（`npm test|run` で `--` より前の `--script-shell`・`--node-options`・`--<名前>=<値>`）
  // `npm test|run`（`t`・`run-script` を含む）は、引用符・バックスラッシュを含む形と、`--` より前の `-` で始まる引数をすべて断る（`npm run <名前>` と `npm run <名前> -- <引数>` だけ通す）
  for (const m of src.matchAll(/(?:^|[\s(])npm(?:\s((?:[^|\n]|(?<=>)\|)*))?/g)) {
    const args = m[1] ?? "";
    const w = words(args);
    if (!w.some((a) => ["test", "t", "run", "run-script"].includes(a))) continue;
    const dd = w.indexOf("--");
    const before = dd < 0 ? w : w.slice(0, dd);
    if (/['"\\]/.test(args) || before.some((a) => a.startsWith("-"))) {
      return { deny: true, reason: `\`npm test\`・\`npm run\` に、引用符・バックスラッシュを含む形や、\`--\` より前に \`-\` で始まる引数（\`--script-shell\`・\`--node-options\`・\`--prefix\`・\`--userconfig\`・\`-C\` など）を付けた形は、任意のコマンドや設定を動かせるので実行しません。引数は \`--\` の後ろに置いてください。${SPLIT}` };
    }
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
