"""Retrospective staleness detector, rules S1-S4 of PROTOCOL.md. Read-only over ./corpus.

Output: raw/flags.jsonl (one flag per note-anchor that fired) and raw/stats.json.
Every git call's stdout is used directly; nothing here writes to the corpus.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus"
HEAD = "7678acf35964b8149e686f0d06431da074785303"
SOURCE_GLOBS = ["*.js", "*.mjs", "*.cjs", "*.ts", "*.py", "*.sh"]
TICK = re.compile(r"`([^`\n]+)`")
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{3,}$")
PATHLIKE = re.compile(r"^[A-Za-z0-9_./-]+\.(js|mjs|cjs|ts|py|sh|json|md|yml|yaml|toml|txt|css|html)$")
HEADING = re.compile(r"^#{1,6}\s")
NON_PROD = re.compile(r"(^|/)(tests?|fixtures|__tests__)/|(^|/)test_[^/]*$|\.test\.|\.spec\.|/data/[^/]*_before_split")


def git(*args: str) -> str:
    out = subprocess.run(["git", *args], cwd=CORPUS, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode not in (0, 1):  # grep's 1 means "no match"; anything else is a broken instrument
        raise RuntimeError(f"git {' '.join(args)} -> {out.returncode}: {out.stderr[:300]}")
    return out.stdout


@lru_cache(maxsize=None)
def tree(commit: str) -> tuple[str, ...]:
    return tuple(git("ls-tree", "-r", "--name-only", commit).splitlines())


@lru_cache(maxsize=None)
def resolve_path(token: str, commit: str) -> str | None:
    files = tree(commit)
    if token in files:
        return token
    if "/" not in token:
        hits = [f for f in files if f.rsplit("/", 1)[-1] == token]
        return hits[0] if len(hits) == 1 else None  # ambiguous basename: not an anchor
    return None


def definition_pattern(sym: str) -> str:
    s = re.escape(sym)
    return "|".join([
        rf"function\*?\s+{s}\b", rf"class\s+{s}\b", rf"(const|let|var)\s+{s}\s*=", rf"def\s+{s}\s*\(",
        rf"^\s*(async\s+)?(static\s+)?(get\s+|set\s+)?{s}\s*\([^)]*\)\s*\{{", rf"^{s}\s*=", rf"^{s}\s*\(\)\s*\{{",
    ])


@lru_cache(maxsize=None)
def defining_files(sym: str, commit: str) -> tuple[str, ...]:
    out = git("grep", "-l", "-E", definition_pattern(sym), commit, "--", *SOURCE_GLOBS)
    return tuple(sorted({line.split(":", 1)[1] for line in out.splitlines() if ":" in line}))


@lru_cache(maxsize=None)
def prod_referrers(word: str, commit: str, exclude: tuple[str, ...]) -> tuple[str, ...]:
    out = git("grep", "-l", "-w", "-F", word, commit, "--", *SOURCE_GLOBS)
    files = {line.split(":", 1)[1] for line in out.splitlines() if ":" in line}
    return tuple(sorted(f for f in files if f not in exclude and not NON_PROD.search(f)))


JS_COMMENT = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)
PY_STRING_BLOCK = re.compile(r'""".*?"""|' + r"'''.*?'''", re.S)
HASH_COMMENT = re.compile(r"(^|\s)#[^\n]*")


@lru_cache(maxsize=None)
def code_text(path: str, commit: str) -> str:
    """The file with comments (and Python docstrings) removed. Naive: a `//` inside a JS string such as a
    URL also truncates its line, which can only HIDE a reference, never invent one."""
    src = git("show", f"{commit}:{path}")
    if path.endswith((".js", ".mjs", ".cjs", ".ts")):
        return JS_COMMENT.sub(" ", src)
    if path.endswith(".py"):
        return HASH_COMMENT.sub(" ", PY_STRING_BLOCK.sub(" ", src))
    if path.endswith(".sh"):
        return HASH_COMMENT.sub(" ", src)
    return src


@lru_cache(maxsize=None)
def code_referrers(word: str, commit: str, exclude: tuple[str, ...]) -> tuple[str, ...]:
    pattern = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(word) + r"(?![A-Za-z0-9_])")
    return tuple(f for f in prod_referrers(word, commit, exclude) if pattern.search(code_text(f, commit)))


def blame_commits(doc: str) -> list[str]:
    commits, current = [], None
    for line in git("blame", "--line-porcelain", HEAD, "--", doc).splitlines():
        if re.match(r"^[0-9a-f]{40} ", line):
            current = line.split()[0]
        elif line.startswith("\t"):
            commits.append(current)
    return commits


def notes(doc: str) -> list[tuple[str, int, int]]:
    lines = git("show", f"{HEAD}:{doc}").splitlines()
    heads = [i for i, l in enumerate(lines) if HEADING.match(l)] or [0]
    if heads[0] != 0:
        heads = [0] + heads
    return [(lines[s].strip()[:120], s, (heads[k + 1] if k + 1 < len(heads) else len(lines))) for k, s in enumerate(heads)]


def main() -> None:
    population = [p for p in (ROOT / "raw" / "population.txt").read_text().split() if p.endswith(".md")]
    assert len(population) == 31, len(population)
    flags, stats = [], {"docs": 0, "notes": 0, "notes_with_anchors": 0, "anchors": 0, "path_anchors": 0, "symbol_anchors": 0}
    for doc in population:
        stats["docs"] += 1
        text = git("show", f"{HEAD}:{doc}").splitlines()
        blame = blame_commits(doc)
        assert len(blame) == len(text), f"blame/text length mismatch for {doc}"
        for title, start, end in notes(doc):
            stats["notes"] += 1
            seen, had_anchor = set(), False
            for ln in range(start, end):
                for token in TICK.findall(text[ln]):
                    token = token.strip().strip("()")
                    if token in seen:
                        continue
                    seen.add(token)
                    w = blame[ln]
                    fired = evaluate(token, w)
                    if fired is None:
                        continue
                    had_anchor = True
                    stats["anchors"] += 1
                    stats["path_anchors" if fired["kind"] == "path" else "symbol_anchors"] += 1
                    if fired.get("rule") or fired.get("rule_a"):
                        flags.append({"doc": doc, "note": title, "line": ln + 1, "anchor": token, "written_in": w[:10], **fired})
            stats["notes_with_anchors"] += had_anchor
        print(f"{doc}: flags so far {len(flags)}", file=sys.stderr)
    (ROOT / "raw" / "flags.jsonl").write_text("".join(json.dumps(f) + "\n" for f in flags), encoding="utf-8")
    stats["flags"] = len(flags)
    stats["notes_flagged_registered"] = len({(f["doc"], f["note"]) for f in flags if f.get("rule")})
    stats["notes_flagged_amended"] = len({(f["doc"], f["note"]) for f in flags if f.get("rule_a")})
    stats["by_rule"] = {r: sum(f.get("rule") == r for f in flags) for r in ("S1", "S2", "S3", "S4")}
    stats["by_rule_a"] = {r: sum(f.get("rule_a") == r for f in flags) for r in ("S1", "S2", "S3a", "S4a")}
    (ROOT / "raw" / "stats.json").write_text(json.dumps(stats, indent=1), encoding="utf-8")
    print(json.dumps(stats, indent=1))


def evaluate(token: str, w: str) -> dict | None:
    """None: not an anchor. {'kind':..} with or without 'rule': an anchor, fired or not."""
    if PATHLIKE.match(token):
        then = resolve_path(token, w)
        if not then:
            return None
        now = resolve_path(token, HEAD) or (then if then in tree(HEAD) else None)
        if not now:
            return {"kind": "path", "rule": "S1", "rule_a": "S1", "then": then}
        stem = then.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        out = {"kind": "path"}
        if len(stem) >= 5 and not then.endswith(".md"):
            if prod_referrers(stem, w, (then,)) and not prod_referrers(stem, HEAD, (now,)):
                out["rule"] = "S4"
            before_a = code_referrers(stem, w, (then,))
            if before_a and not code_referrers(stem, HEAD, (now,)):
                out.update(rule_a="S4a", then=then, code_referrers_then=list(before_a)[:5])
        return out
    if IDENT.match(token):
        defs_then = defining_files(token, w)
        if not defs_then:
            return None
        defs_now = defining_files(token, HEAD)
        if not defs_now:
            return {"kind": "symbol", "rule": "S2", "rule_a": "S2", "defined_then": list(defs_then)}
        out = {"kind": "symbol"}
        if prod_referrers(token, w, defs_then) and not prod_referrers(token, HEAD, defs_now):
            out["rule"] = "S3"
        before_a = code_referrers(token, w, defs_then)
        if before_a and not code_referrers(token, HEAD, defs_now):
            out.update(rule_a="S3a", code_referrers_then=list(before_a)[:5], defined_now=list(defs_now))
        return out
    return None


if __name__ == "__main__":
    main()
