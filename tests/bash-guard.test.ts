import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
// @ts-expect-error: フックは依存を持たない .mjs（型の宣言は無い）
import { check } from "../.claude/hooks/bash-guard.mjs";

const denied = (c: string) => (check(c) as { deny: boolean }).deny;

describe("Bash のフック（文字の許可リスト。承認の画面で止まりやすい形を断る）", () => {
  it("つなぎ・裏での実行・リダイレクト・展開・ヒアドキュメントなど、許さない文字を 1 つでも含めば断る（引用符の中も）", () => {
    for (const c of [
      "cd /x && git status",
      "git add -A; git commit -m x",
      "git pull || echo ng",
      "sleep 1 & echo x",
      "(python3 -m http.server 6006 &)",
      "echo a 2>&1",
      "echo a > /tmp/x",
      "cat < /tmp/x",
      "echo $HOME",
      "echo ${HOME}",
      "cat $(ls)",
      "echo `date`",
      "echo a\\b",
      "ls (x)",
      "echo {a,b}",
      "git status\ngit log",
      "cat > /tmp/x.js <<'EOF'\nconsole.log(1)\nEOF",
      'git commit -m "a; b"',
      "echo 'a && b'",
      "find . -exec ls {} \\;",
      "rm -rf $S",
    ]) assert.equal(denied(c), true, c);
  });

  it("`|` は head・tail・grep・wc・sort に渡す形だけ通す。それ以外・空の `|`・`||` は断る", () => {
    for (const c of ["ls src | head -5", "git log --oneline | tail -3", "grep -n foo src/x.ts | wc -l", "ls | sort", "git diff --stat | grep claim | head"]) assert.equal(denied(c), false, c);
    for (const c of ["ls | sh", "cat x | node", "ls | xargs rm", "ls | tee /tmp/x", "ls | python3", "ls ||", "a || b", "| head", "ls | head | sh"]) assert.equal(denied(c), true, c);
  });

  it("先頭の NAME=value の前置きは断る（パイプの後ろも）", () => {
    for (const c of ["FOO=bar npm test", "NODE_OPTIONS=x npm test", "npm_config_script_shell=sh npm run x", "GIT_DIR=/x git status", "ls | FOO=1 head"]) assert.equal(denied(c), true, c);
    for (const c of ["git commit -m a=b", "grep a=b x.txt", "npm run build -- --foo=bar"]) assert.equal(denied(c), false, c);
  });

  it("git の -c・--config-env・--exec-path・--git-dir・--work-tree は断る。-C は通す", () => {
    for (const c of [
      "git -c core.pager=x log",
      "git -C /x -c core.x=1 status",
      "git --config-env=core.x=Y status",
      "git --exec-path=/tmp/x status",
      "git --exec-path status",
      "git --git-dir=/x status",
      "git --work-tree=/x status",
      "/usr/bin/git -c a.b=c log",
    ]) assert.equal(denied(c), true, c);
    for (const c of ["git -C /x log --oneline -5", "git --no-pager log", "git commit -c HEAD", "git log -c"]) assert.equal(denied(c), false, c);
  });

  it("手元の変更を捨てる git（checkout ... --・checkout .・restore・reset --hard・clean -f・checkout claude/<ブランチ> に続く引数）は断る。ブランチを替えるだけは通す", () => {
    for (const c of [
      "git checkout -- .",
      "git checkout claude/x -- src/a.ts",
      "git checkout .",
      "git restore src/a.ts",
      "git reset --hard",
      "git reset --hard origin/main",
      "git clean -f",
      "git clean -fd",
      "git clean --force",
      "git -C /x reset --hard",
      "git -C /x restore a.ts",
      "git checkout claude/issue-1 src/a.ts",
      "git checkout claude/issue-1 package.json",
    ]) assert.equal(denied(c), true, c);
    for (const c of [
      "git checkout claude/issue-1",
      "git checkout -b claude/kaizen-x",
      "git checkout -B claude/x origin/claude/x",
      "git checkout main",
      "git reset HEAD~1",
      "git clean -n",
      "git clean -nd",
    ]) assert.equal(denied(c), false, c);
  });

  it("通す例（1 つのコマンド）", () => {
    for (const c of [
      "npm test",
      "npm run build",
      "git status",
      "git -C /x log --oneline -5",
      'git commit -m "直す"',
      "ls src | head -5",
      "grep -n foo src/x.ts",
      "node /tmp/x/check.mjs",
      "npm run build -- --foo",
      "node scripts/factory/claim.ts gate --role review --number 1",
      "python3 scripts/check-skills.py",
      "git commit -F /tmp/msg.txt",
    ]) assert.equal(denied(c), false, c);
  });

  it("断るときの文言に、分け方（1 回に 1 コマンド・Write でスクリプト・run_in_background・git commit -F）を書く", () => {
    for (const c of ["ls; pwd", "npm start &", "echo $HOME", "ls | sh", "FOO=1 npm test", "git -c a.b=c log"]) {
      const r = check(c) as { reason: string };
      assert.match(r.reason, /1 回に 1 コマンド/, c);
      assert.match(r.reason, /Write/, c);
      assert.match(r.reason, /run_in_background/, c);
      assert.match(r.reason, /git commit -F/, c);
      assert.match(r.reason, /新しい名前/, c);
    }
  });

  it("フックとして動かすと、断るときだけ deny の JSON を返し、終了コードは 0", () => {
    const run = (command: string, tool = "Bash") =>
      spawnSync(process.execPath, [".claude/hooks/bash-guard.mjs"], { input: JSON.stringify({ tool_name: tool, tool_input: { command } }), encoding: "utf8" });
    const ng = run("cd x && git status");
    assert.equal(ng.status, 0);
    const out = JSON.parse(ng.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /1 回に 1 コマンド/);
    const ok = run("git status");
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout, "");
    assert.equal(run("cd x && git status", "Read").stdout, "");
    // 読めない入力は判定しない
    assert.equal(spawnSync(process.execPath, [".claude/hooks/bash-guard.mjs"], { input: "not json", encoding: "utf8" }).stdout, "");
  });
});
