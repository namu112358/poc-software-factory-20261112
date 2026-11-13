import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
// @ts-expect-error: フックは依存を持たない .mjs（型の宣言は無い）
import { check } from "../.claude/hooks/bash-guard.mjs";

const denied = (c: string) => (check(c) as { deny: boolean }).deny;

describe("Bash のフック（承認の画面で止まりやすい形を断る）", () => {
  it("git をつないだ形は断る", () => {
    for (const c of [
      "cd /home/user/repo && git status",
      "git fetch -q origin main && git merge --no-edit origin/main",
      "git add -A; git commit -m x",
      "git pull || echo ng",
      "npm test && git push origin claude/x",
      "git status\ngit log",
    ]) assert.equal(denied(c), true, c);
  });

  it("rm -rf は断る", () => {
    for (const c of ["rm -rf node_modules", "rm -fr /tmp/x", "rm -r -f dist", "ls; rm -rf x"]) assert.equal(denied(c), true, c);
  });

  it("手元の変更を捨てる形（checkout -- ・checkout .・restore）は断る。ブランチを替えるだけの checkout は通す", () => {
    for (const c of ["git checkout -- .", "git checkout claude/x -- src/a.ts", "git checkout .", "git restore src/a.ts"]) assert.equal(denied(c), true, c);
    for (const c of ["git checkout claude/issue-1", "git checkout -b claude/kaizen-x", "git checkout main"]) assert.equal(denied(c), false, c);
  });

  it("rm の再帰と強制は、書き方を問わず断る（-Rf・--recursive --force・-r --force）。-f だけ・-r だけは通す", () => {
    for (const c of ["rm -Rf x", "rm --recursive --force x", "rm -r --force x", "rm --force -R x"]) assert.equal(denied(c), true, c);
    for (const c of ["rm -f x", "rm -r emptydir"]) assert.equal(denied(c), false, c);
  });

  it("git reset --hard・git clean -f も、手元の変更を捨てる形として断る。git reset（--hard なし）・git clean -n は通す", () => {
    for (const c of ["git reset --hard", "git reset --hard origin/main", "git clean -f", "git clean -fd", "git clean --force"]) assert.equal(denied(c), true, c);
    for (const c of ["git reset HEAD~1", "git clean -n", "git clean -nd"]) assert.equal(denied(c), false, c);
  });

  it("git の全体のオプション（-C・-c）の後でも、手元の変更を捨てる形は断る", () => {
    for (const c of ["git -C x reset --hard", "git -C /repo clean -f", "git -c core.x=1 checkout -- .", "git --no-pager -C x restore a.ts"]) assert.equal(denied(c), true, c);
    for (const c of ["git -C x status", "git -C x reset HEAD~1"]) assert.equal(denied(c), false, c);
  });

  it("rm の長い名前の省略（--rec・--forc・--force=）も断る", () => {
    for (const c of ["rm --rec --forc x", "rm --recursive -f x", "rm -R --for x"]) assert.equal(denied(c), true, c);
  });

  it("シェルのパス・長いオプション・$'...' の -c も中身を見る", () => {
    for (const c of ['/bin/bash -c "cd x && git status"', 'bash --norc -c "cd x && git log"', "bash -c $'cd x && git status'", "dash -c 'rm -rf x'"]) assert.equal(denied(c), true, c);
  });

  it("bash -c・sh -c の中身も同じ決まりで見る", () => {
    for (const c of ['bash -c "cd x && git status"', "sh -c 'git add . ; git commit -m x'", 'bash -lc "cd x && git log"', "bash -c 'rm -rf x'"]) assert.equal(denied(c), true, c);
    for (const c of ['bash -c "npm test"', "sh -c 'git status'"]) assert.equal(denied(c), false, c);
  });

  it("ヒアドキュメントで python・node に流す形は断る", () => {
    for (const c of ["python3 - <<'EOF'\nprint(1)\nEOF", "node <<EOF\nconsole.log(1)\nEOF", "cat <<'EOF' | python3\nprint(1)\nEOF"]) assert.equal(denied(c), true, c);
  });

  it("1 つのコマンド・読むだけのパイプ・引用符の中の区切りは通す", () => {
    for (const c of [
      "git status",
      "git -C /home/user/repo log --oneline -5",
      "git log --oneline | head -5",
      "git diff --stat | grep claim",
      'git commit -m "直す; 理由 && 補足"',
      "npm test",
      "node scripts/factory/claim.ts gate --role review --number 1",
      "rm tmp.txt",
      "cat <<'EOF' > /tmp/x.md\n本文; git && x\nEOF",
      "python3 scripts/check-skills.py",
    ]) assert.equal(denied(c), false, c);
  });

  it("git を含まなくても、`;`・`&&`・`||` でつないだ形は断る。引用符の中・パイプ・`\\;` は通す", () => {
    for (const c of ["npm run build && npm test", "ls; pwd", "test -f a || echo ng", "echo a;echo b", "mkdir /tmp/x && node /tmp/x/a.mjs"]) assert.equal(denied(c), true, c);
    for (const c of ["ls | head -5", 'echo "a; b && c"', "echo 'a || b'", "find . -name x -exec ls {} \\;"]) assert.equal(denied(c), false, c);
  });

  it("`&` で裏で動かす形は断る。`2>&1`・`>&2` は通す", () => {
    for (const c of ["python3 -m http.server 6006 &", "(python3 -m http.server 6006 &)", "npm start &", "sleep 1 & echo x"]) assert.equal(denied(c), true, c);
    for (const c of ["echo a 2>&1", "echo a >&2", "npm test 2>&1 | tail -5", "npm test &> /tmp/x.log", 'echo "a & b"']) assert.equal(denied(c), false, c);
  });

  it("シェル変数の代入・展開（$NAME・${...}・$(...)・バッククォート）は断る。環境変数の前置きだけは通す", () => {
    for (const c of ["echo $HOME", "ls ${TMPDIR}/x", "cat $(ls)", "echo `date`", 'echo "$S/check.js"', "cat > $S/check.js <<'EOF'\nconsole.log(1)\nEOF", "S=/tmp/x\nnode $S/a.mjs", "S=/tmp/x\nls /tmp"]) assert.equal(denied(c), true, c);
    for (const c of ["FOO=bar npm test", "NODE_ENV=test node /tmp/x/check.mjs", "echo '$HOME'", 'echo "cost \\$5"', 'git commit -m "直す: 値は $5 ではない"']) assert.equal(denied(c), false, c);
  });

  it("断るときの文言に、分け方（1 回に 1 コマンド・Write でスクリプト・run_in_background）を書く", () => {
    for (const c of ["ls; pwd", "npm start &", "echo $HOME"]) {
      const r = check(c) as { reason: string };
      assert.match(r.reason, /1 回に 1 コマンド/, c);
      assert.match(r.reason, /Write/, c);
      assert.match(r.reason, /run_in_background/, c);
      assert.match(r.reason, /新しい名前/, c);
    }
  });

  it("git diff・log・show の --output・-o、npm の設定の引数、checkout claude/<ブランチ> に続く引数は断る", () => {
    for (const c of [
      "git diff --output=/tmp/x.patch",
      "git -C /x log --output /tmp/x",
      "git show -o /tmp/x HEAD",
      "git diff -ofile",
      "npm test --script-shell=/tmp/x.sh",
      "npm run build --script-shell /tmp/x.sh",
      "npm run build --node-options=--require=/tmp/x.js",
      "npm test --foo=bar",
      "npm run build --cache=/tmp/x -- --foo",
      "git checkout claude/issue-1 src/a.ts",
      "git -C /x checkout claude/issue-1 package.json",
    ]) assert.equal(denied(c), true, c);
    for (const c of [
      "git status",
      "git -C /x log --oneline",
      "git log --oneline | grep -o x",
      "git diff --output-indicator-new=+",
      "npm test",
      "npm run build -- --foo",
      "npm run build -- --foo=bar",
      "git checkout claude/issue-1",
      "git -C /x checkout -B claude/x origin/claude/x",
      "git checkout claude/issue-1 2>&1",
      "node /tmp/x/check.mjs",
    ]) assert.equal(denied(c), false, c);
  });

  it("git diff・log・show・checkout と npm test・run の引数に引用符・バックスラッシュがあれば断る", () => {
    for (const c of [
      'git diff "--output=x"',
      "git diff --out\\put=x",
      "git log '--output=x'",
      'git show "HEAD"',
      'git checkout "claude/x"',
      "npm run build '--script-shell=sh'",
      'npm test "--userconfig=x"',
      "npm run build -- --grep 'a b'",
      "npm run-script b\\uild",
    ]) assert.equal(denied(c), true, c);
    for (const c of ["git diff --stat", "git log --oneline -5", "npm run build -- --foo", "npm test"]) assert.equal(denied(c), false, c);
  });

  it("npm test・run は、`--` より前の `-` で始まる引数をすべて断る（空白区切り・--prefix・-C を含む）。`npm run <名前>` と `-- <引数>` は通す", () => {
    for (const c of [
      "npm run build --userconfig x",
      "npm test --prefix /tmp/x",
      "npm run build -C /tmp/x",
      "npm --prefix /tmp/x run build",
      "npm t --ignore-scripts",
      "npm run-script build --silent",
      "npm run build --foo -- --bar",
    ]) assert.equal(denied(c), true, c);
    for (const c of ["npm run build", "npm run build -- --foo", "npm run build -- --userconfig x", "npm test -- --test-name-pattern=x", "npm test 2>&1", "npm run build 2>&1 | tail -3", "npm ci", "npm install"]) assert.equal(denied(c), false, c);
  });

  it("git checkout claude/<ブランチ> の後ろの引数は、リダイレクトを挟んでも断る。リダイレクトだけなら通す", () => {
    for (const c of [
      "git checkout claude/x 2>/dev/null src/a.ts",
      "git checkout claude/x >/dev/null package.json",
      "git checkout claude/x 2>&1 src/a.ts",
      "git -C /x checkout claude/x > /tmp/o src/a.ts",
      "git checkout claude/x src/a.ts 2>&1",
    ]) assert.equal(denied(c), true, c);
    for (const c of ["git checkout claude/x 2>&1", "git checkout claude/x > /tmp/o", "git checkout claude/x 2>/dev/null"]) assert.equal(denied(c), false, c);
  });

  it("フックとして動かすと、断るときだけ deny の JSON を返し、終了コードは 0", () => {
    const run = (command: string, tool = "Bash") =>
      spawnSync(process.execPath, [".claude/hooks/bash-guard.mjs"], { input: JSON.stringify({ tool_name: tool, tool_input: { command } }), encoding: "utf8" });
    const ng = run("cd x && git status");
    assert.equal(ng.status, 0);
    const out = JSON.parse(ng.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /1 コマンドずつ/);
    const ok = run("git status");
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout, "");
    assert.equal(run("cd x && git status", "Read").stdout, "");
    // 読めない入力は判定しない
    assert.equal(spawnSync(process.execPath, [".claude/hooks/bash-guard.mjs"], { input: "not json", encoding: "utf8" }).stdout, "");
  });
});
