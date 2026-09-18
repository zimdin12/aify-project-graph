"""Test 3 detector (PROTOCOL-3.md): file-scoped anchors, two classes (GONE, DEAD_NAME). Read-only over ./corpus.

Output: raw/flags.jsonl and raw/stats.json. Nothing here writes to the corpus.
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
SOURCE_GLOBS = ["*.js", "*.mjs", "*.cjs", "*.ts", "*.py", "*.sh"]
TICK = re.compile(r"`([^`\n]+)`")
# A code name has an uppercase letter, an underscore or a digit; a plain lowercase word is prose.
IDENT = re.compile(r"^(?=.*[A-Z_0-9])[A-Za-z_][A-Za-z0-9_]{3,}$")
PATHLIKE = re.compile(r"^[A-Za-z0-9_./-]+\.(js|mjs|cjs|ts|py|sh|json|md|yml|yaml|toml|txt|css|html)$")
HEADING = re.compile(r"^#{1,6}\s")
NON_PROD = re.compile(r"(^|/)(tests?|fixtures|__tests__)/|(^|/)test_[^/]*$|\.test\.|\.spec\.")
JS_COMMENT = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)
PY_STRING_BLOCK = re.compile(r'""".*?"""|' + r"'''.*?'''", re.S)
HASH_COMMENT = re.compile(r"(^|\s)#[^\n]*")


def git(*args: str) -> str:
    out = subprocess.run(["git", *args], cwd=CORPUS, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode not in (0, 1):
        raise RuntimeError(f"git {' '.join(args)} -> {out.returncode}: {out.stderr[:300]}")
    return out.stdout


HEAD = git("rev-parse", "HEAD").strip()


@lru_cache(maxsize=None)
def tree(commit: str) -> frozenset[str]:
    return frozenset(git("ls-tree", "-r", "--name-only", commit).splitlines())


@lru_cache(maxsize=None)
def resolve_path(token: str, commit: str) -> str | None:
    files = tree(commit)
    if token in files:
        return token
    if "/" not in token:
        hits = [f for f in files if f.rsplit("/", 1)[-1] == token]
        return hits[0] if len(hits) == 1 else None
    return None


@lru_cache(maxsize=None)
def renames(commit: str) -> dict[str, str]:
    """old path at `commit` -> path at HEAD, for files git sees as renamed between them."""
    out = {}
    for line in git("diff", "-M", "--name-status", commit, HEAD).splitlines():
        parts = line.split("\t")
        if parts and parts[0].startswith("R") and len(parts) == 3:
            out[parts[1]] = parts[2]
    return out


def definition_pattern(sym: str) -> str:
    s = re.escape(sym)
    return "|".join([
        rf"function\*?\s+{s}\b", rf"class\s+{s}\b", rf"(const|let|var)\s+{s}\s*=", rf"def\s+{s}\s*\(",
        rf"^\s*(async\s+)?(static\s+)?(get\s+|set\s+)?{s}\s*\([^)]*\)\s*\{{", rf"^{s}\s*=", rf"^{s}\s*\(\)\s*\{{",
        rf"\bas\s+{s}\b", rf"^\s*{s}\s*:", rf"this\.{s}\s*=",
    ])


@lru_cache(maxsize=None)
def defining_files(sym: str, commit: str) -> tuple[str, ...]:
    out = git("grep", "-l", "-E", definition_pattern(sym), commit, "--", *SOURCE_GLOBS)
    return tuple(sorted({line.split(":", 1)[1] for line in out.splitlines() if ":" in line}))


@lru_cache(maxsize=None)
def grep_referrers(word: str, commit: str, exclude: tuple[str, ...]) -> tuple[str, ...]:
    out = git("grep", "-l", "-w", "-F", word, commit, "--", *SOURCE_GLOBS)
    files = {line.split(":", 1)[1] for line in out.splitlines() if ":" in line}
    return tuple(sorted(f for f in files if f not in exclude and not NON_PROD.search(f)))


@lru_cache(maxsize=None)
def code_text(path: str, commit: str) -> str:
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
    return tuple(f for f in grep_referrers(word, commit, exclude) if pattern.search(code_text(f, commit)))


def evaluate(token: str, w: str) -> dict | None:
    if PATHLIKE.match(token):
        then = resolve_path(token, w)
        if not then:
            return None
        now = resolve_path(token, HEAD) or (then if then in tree(HEAD) else None)
        if not now:
            moved = renames(w).get(then)
            if moved:
                return {"kind": "path", "cls": "DEAD_NAME", "rule": "S1r", "then": then, "now": moved}
            return {"kind": "path", "cls": "GONE", "rule": "S1d", "then": then}
        stem = then.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        if len(stem) >= 5 and not then.endswith(".md"):
            before = code_referrers(stem, w, (then,))
            if before and not code_referrers(stem, HEAD, (now,)):
                return {"kind": "path", "cls": "GONE", "rule": "S4a", "then": then, "code_referrers_then": list(before)[:5]}
        return {"kind": "path"}
    if IDENT.match(token):
        defs_then = defining_files(token, w)
        if not defs_then:
            return None
        lineage = {renames(w).get(f, f) for f in defs_then}
        defs_now = defining_files(token, HEAD)
        if not [f for f in defs_now if f in lineage]:
            return {"kind": "symbol", "cls": "DEAD_NAME", "rule": "S2f", "defined_then": list(defs_then),
                    "defined_now_elsewhere": list(defs_now)[:5]}
        before = code_referrers(token, w, defs_then)
        if before and not code_referrers(token, HEAD, defs_now):
            return {"kind": "symbol", "cls": "GONE", "rule": "S3a", "code_referrers_then": list(before)[:5],
                    "defined_now": list(defs_now)[:5]}
        return {"kind": "symbol"}
    return None


def blame_commits(doc: str) -> list[str]:
    commits, current = [], None
    for line in git("blame", "--line-porcelain", HEAD, "--", doc).splitlines():
        if re.match(r"^[0-9a-f]{40} ", line):
            current = line.split()[0]
        elif line.startswith("\t"):
            commits.append(current)
    return commits


def notes(lines: list[str]) -> list[tuple[str, int, int]]:
    heads = [i for i, l in enumerate(lines) if HEADING.match(l)] or [0]
    if heads[0] != 0:
        heads = [0] + heads
    return [(lines[s].strip()[:120], s, (heads[k + 1] if k + 1 < len(heads) else len(lines))) for k, s in enumerate(heads)]


def main() -> None:
    population = [p for p in (ROOT / "raw" / "population.txt").read_text(encoding="utf-8").split() if p.endswith(".md")]
    assert len(population) == 36, len(population)
    flags, rows = [], []
    stats = {"docs": 0, "notes": 0, "notes_with_anchors": 0, "anchors": 0}
    for doc in population:
        stats["docs"] += 1
        text = git("show", f"{HEAD}:{doc}").splitlines()
        blame = blame_commits(doc)
        assert len(blame) == len(text), f"blame/text length mismatch for {doc}"
        for k, (title, start, end) in enumerate(notes(text)):
            stats["notes"] += 1
            rows.append({"note_id": f"{doc}#{k}", "doc": doc, "heading": title, "lines": f"{start + 1}-{end}"})
            seen, had_anchor = set(), False
            for ln in range(start, end):
                for token in TICK.findall(text[ln]):
                    token = token.strip().strip("()")
                    if token in seen:
                        continue
                    seen.add(token)
                    fired = evaluate(token, blame[ln])
                    if fired is None:
                        continue
                    had_anchor = True
                    stats["anchors"] += 1
                    if fired.get("cls"):
                        flags.append({"note_id": f"{doc}#{k}", "doc": doc, "note": title, "line": ln + 1,
                                      "anchor": token, "written_in": blame[ln][:10], **fired})
            stats["notes_with_anchors"] += had_anchor
        print(f"{doc}: flags so far {len(flags)}", file=sys.stderr)
    (ROOT / "raw" / "flags.jsonl").write_text("".join(json.dumps(f) + "\n" for f in flags), encoding="utf-8")
    (ROOT / "raw" / "notes.json").write_text(json.dumps(rows, indent=0), encoding="utf-8")
    stats["flags"] = len(flags)
    stats["by_rule"] = {r: sum(f["rule"] == r for f in flags) for r in ("S1d", "S1r", "S2f", "S3a", "S4a")}
    stats["by_class"] = {c: sum(f["cls"] == c for f in flags) for c in ("GONE", "DEAD_NAME")}
    stats["notes_flagged"] = len({f["note_id"] for f in flags})
    (ROOT / "raw" / "stats.json").write_text(json.dumps(stats, indent=1), encoding="utf-8")
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
