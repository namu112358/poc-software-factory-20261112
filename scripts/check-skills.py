#!/usr/bin/env python3
"""Skills（.claude/skills/）を、モデルを呼ばずに機械的に検査する。

使い方:
  python3 scripts/check-skills.py                # 検査する（エラーがあれば終了コード 1）
  python3 scripts/check-skills.py --update-lock  # vendored Skills の指紋（scripts/skills.lock.json）を作り直す
  python3 scripts/check-skills.py --root <パス>   # 別のリポジトリを検査する（配布先のスクリプトを実行せずに済む）

検査の内容:
- vendored Skills（scripts/skills.lock.json に載っているもの）
  - 内容が指紋と一致する（手で編集されていない）。更新は scripts/sync-skills.sh・scripts/add-stack.sh で行い、--update-lock で指紋を作り直す。
  - .claude/skills/SOURCES.md に載っている。SOURCES.md に載っているのに指紋がないものも検出する。
  - 形式の問題（上流の書き方によるもの）は警告だけにする。手で直せないため。
- 自作の Skills（指紋に載っていないもの）
  - 名前が `namu112358-` で始まる（SOURCES.md の vendored の表に載っているものは vendored として扱う。vendored の Skill と見分けるため）。
  - SKILL.md の frontmatter が skill-creator の quick_validate.py の検査を通る。
  - frontmatter の name がディレクトリ名と一致する。
  - SKILL.md が 500 行以内（skill-creator の指針）。
  - SKILL.md から相対パスで参照しているファイルが存在する。
  - evals/evals.json（skill-creator の形式）がある。各ケースに id・prompt・expectations があり、files が存在する。
  - evals/trigger.json（発火の評価。{"query", "should_trigger"} の配列）があり、発火すべき例と発火すべきでない例の両方を含む。
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def set_root(root: Path) -> None:
    """検査するリポジトリを決める（既定はこのスクリプトが置かれたリポジトリ）。"""
    global ROOT, SKILLS, SOURCES, LOCK, QUICK_VALIDATE
    ROOT = root.resolve()
    SKILLS = ROOT / ".claude" / "skills"
    SOURCES = SKILLS / "SOURCES.md"
    LOCK = ROOT / "scripts" / "skills.lock.json"
    QUICK_VALIDATE = SKILLS / "skill-creator" / "scripts"


set_root(ROOT)
MAX_LINES = 500
OWN_PREFIX = "namu112358-"  # 自作の Skill の名前の接頭辞
MIN_TRIGGER_EACH = 5  # 発火する例・しない例のそれぞれ。skill-creator の推奨は合わせて 20 件


def skill_dirs():
    if not SKILLS.is_dir():
        return []
    return sorted(p for p in SKILLS.iterdir() if p.is_dir())


def tree_hash(path: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(p for p in path.rglob("*") if p.is_file()):
        if "__pycache__" in f.parts:
            continue
        h.update(f.relative_to(path).as_posix().encode() + b"\0")
        h.update(hashlib.sha256(f.read_bytes()).digest())
    return h.hexdigest()


def sources_dirs() -> set:
    """SOURCES.md の表の「パス」列（`skills/<dir>`）から、ディレクトリ名を取り出す。"""
    if not SOURCES.exists():
        return set()
    return set(re.findall(r"\|\s*`skills/([a-z0-9-]+)`\s*\|", SOURCES.read_text(encoding="utf-8")))


def load_lock() -> dict:
    return json.loads(LOCK.read_text(encoding="utf-8")) if LOCK.exists() else {}


def frontmatter_check(skill: Path):
    """skill-creator の quick_validate.py を使う（Skills の形式の正本）。"""
    if not (QUICK_VALIDATE / "quick_validate.py").exists():
        return False, "skill-creator（.claude/skills/skill-creator）がないため、形式を検査できません。標準の Skills を入れてください"
    sys.dont_write_bytecode = True  # vendored Skill の中に __pycache__ を作らない
    sys.path.insert(0, str(QUICK_VALIDATE))
    try:
        from quick_validate import validate_skill  # noqa: PLC0415
    finally:
        sys.path.pop(0)
    return validate_skill(skill)


def frontmatter_name(text: str) -> str:
    m = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return ""
    n = re.search(r"^name:\s*['\"]?([^'\"\n]+)", m.group(1), re.MULTILINE)
    return n.group(1).strip() if n else ""


REF_PATTERNS = [
    re.compile(r"\]\(([^)\s#]+)(?:#[^)]*)?\)"),  # Markdown のリンク
    re.compile(r"`((?:scripts|references|assets|evals|agents)/[^`\s]+)`"),  # コード表記のパス
]


def broken_refs(skill: Path) -> list:
    text = (skill / "SKILL.md").read_text(encoding="utf-8")
    refs = set()
    for pat in REF_PATTERNS:
        refs.update(pat.findall(text))
    broken = []
    for r in sorted(refs):
        if re.match(r"^[a-z]+:", r) or r.startswith("/") or any(c in r for c in "<>*{}$"):
            continue  # URL・絶対パス・プレースホルダは対象外
        if not (skill / r).exists():
            broken.append(r)
    return broken


def check_evals(skill: Path, name: str) -> list:
    errors = []
    path = skill / "evals" / "evals.json"
    if not path.exists():
        return ["evals/evals.json がありません（skill-creator の形式で評価ケースを置いてください）"]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"evals/evals.json が JSON として読めません: {e}"]
    if data.get("skill_name") != name:
        errors.append(f"evals/evals.json の skill_name（{data.get('skill_name')!r}）が name（{name!r}）と一致しません")
    cases = data.get("evals")
    if not isinstance(cases, list) or not cases:
        return errors + ["evals/evals.json の evals が空です"]
    seen = set()
    for i, c in enumerate(cases):
        where = f"evals/evals.json の {i + 1} 件目"
        cid = c.get("id")
        if not isinstance(cid, int) or isinstance(cid, bool):
            errors.append(f"{where}: id が整数ではありません")
        elif cid in seen:
            errors.append(f"{where}: id {cid} が重複しています")
        seen.add(cid)
        if not isinstance(c.get("prompt"), str) or not c["prompt"].strip():
            errors.append(f"{where}: prompt が空です")
        exp = c.get("expectations")
        if not isinstance(exp, list) or not exp or not all(isinstance(e, str) and e.strip() for e in exp):
            errors.append(f"{where}: expectations（確かめる内容の文の配列）が空です")
        for f in c.get("files", []) or []:
            if not (skill / f).exists():
                errors.append(f"{where}: files の {f} がありません")
    return errors


def check_trigger(skill: Path) -> tuple:
    path = skill / "evals" / "trigger.json"
    if not path.exists():
        return ["evals/trigger.json（発火の評価）がありません"], []
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"evals/trigger.json が JSON として読めません: {e}"], []
    if not isinstance(items, list) or not all(
        isinstance(x, dict) and isinstance(x.get("query"), str) and x["query"].strip()
        and isinstance(x.get("should_trigger"), bool) for x in items
    ):
        return ["evals/trigger.json は {\"query\": 文字列, \"should_trigger\": 真偽値} の配列にしてください"], []
    pos = sum(x["should_trigger"] for x in items)
    neg = len(items) - pos
    if not pos or not neg:
        return ["evals/trigger.json に、発火すべき例と発火すべきでない例の両方を入れてください"], []
    warns = []
    if pos < MIN_TRIGGER_EACH or neg < MIN_TRIGGER_EACH:
        warns.append(f"evals/trigger.json の例が少なめです（発火する {pos} 件・しない {neg} 件。それぞれ {MIN_TRIGGER_EACH} 件以上を推奨）")
    return [], warns


def check_own(skill: Path) -> tuple:
    errors, warns = [], []
    if not skill.name.startswith(OWN_PREFIX):
        errors.append(f"SOURCES.md の vendored の表に載っていない Skill は、名前を {OWN_PREFIX} で始めてください"
                      "（vendored の Skill と見分けるため）")
    if not (skill / "SKILL.md").exists():
        return ["SKILL.md がありません"], []
    ok, msg = frontmatter_check(skill)
    if not ok:
        errors.append(f"frontmatter: {msg}")
    text = (skill / "SKILL.md").read_text(encoding="utf-8")
    name = frontmatter_name(text)
    if name and name != skill.name:
        errors.append(f"frontmatter の name（{name}）がディレクトリ名（{skill.name}）と一致しません")
    lines = text.count("\n") + 1
    if lines > MAX_LINES:
        errors.append(f"SKILL.md が {lines} 行あります（{MAX_LINES} 行以内にし、詳細は references/ などに分けてください）")
    for r in broken_refs(skill):
        errors.append(f"SKILL.md が参照している {r} がありません")
    errors += check_evals(skill, name or skill.name)
    e, w = check_trigger(skill)
    return errors + e, warns + w


def check_vendored(skill: Path, lock: dict, sources: set) -> tuple:
    errors, warns = [], []
    if skill.name not in lock:
        errors.append("指紋（scripts/skills.lock.json）がありません。--update-lock を実行してください")
    elif tree_hash(skill) != lock[skill.name]:
        errors.append("内容が指紋（scripts/skills.lock.json）と一致しません。vendored Skills は手で編集せず、"
                      "scripts/sync-skills.sh（または scripts/add-stack.sh）で更新し、--update-lock で指紋を作り直してください")
    if skill.name not in sources:
        errors.append(".claude/skills/SOURCES.md に載っていません")
    ok, msg = frontmatter_check(skill)
    if not ok:
        warns.append(f"上流の形式の問題（直さない）: {msg}")
    return errors, warns


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--update-lock", action="store_true", help="SOURCES.md に載っている Skills の指紋を作り直す")
    ap.add_argument("--root", type=Path, help="検査するリポジトリ（既定はこのスクリプトが置かれたリポジトリ）")
    args = ap.parse_args()
    if args.root:
        set_root(args.root)

    sources = sources_dirs()
    if args.update_lock:
        lock = {p.name: tree_hash(p) for p in skill_dirs() if p.name in sources}
        LOCK.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{LOCK.relative_to(ROOT)} を更新しました（{len(lock)} 件）")
        return 0

    if not skill_dirs():
        print(f"{SKILLS.relative_to(ROOT)} に Skills がありません。検査するものはありません")
        return 0
    lock = load_lock()
    present = {p.name for p in skill_dirs()}
    total_errors = 0
    for skill in skill_dirs():
        kind = "vendored" if skill.name in lock or skill.name in sources else "自作"
        errors, warns = check_vendored(skill, lock, sources) if kind == "vendored" else check_own(skill)
        status = "NG" if errors else "OK"
        print(f"[{status}] {skill.name}（{kind}）")
        for e in errors:
            print(f"  エラー: {e}")
        for w in warns:
            print(f"  警告: {w}")
        total_errors += len(errors)
    for name in sorted(set(lock) - present):
        print(f"[NG] {name}: 指紋はあるのに .claude/skills/ にありません（消した場合は --update-lock で指紋を作り直してください）")
        total_errors += 1
    print(f"\nエラー {total_errors} 件")
    return 1 if total_errors else 0


if __name__ == "__main__":
    sys.exit(main())
