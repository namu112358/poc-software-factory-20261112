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
      "npm run build && npm test",
      "node scripts/factory/claim.ts gate --role review --number 1",
      "rm tmp.txt",
      "cat <<'EOF' > /tmp/x.md\n本文; git && x\nEOF",
      "python3 scripts/check-skills.py",
    ]) assert.equal(denied(c), false, c);
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
