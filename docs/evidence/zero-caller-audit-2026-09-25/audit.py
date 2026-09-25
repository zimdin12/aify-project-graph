"""Are apg's EMPTY caller sets correct, after the file-scope fix (d0132af2)?

An empty caller set is the answer that licenses a delete, so it is the one that must not be wrong.
This samples functions the graph says nothing calls, and looks for call-shaped occurrences in the
source with an independent instrument (regex over the repo's own files, not the graph).

Controls, run in the same pass:
  POSITIVE — functions the graph says DO have callers must show call-shaped occurrences here, or the
             instrument cannot see call sites at all and every zero it reports is meaningless.
  NEGATIVE — a fabricated name must show none.
  FRESHNESS — the graph's indexed commit must equal HEAD, or the sample describes a different tree.

Reports counts. A call-shaped occurrence is a CANDIDATE wrong zero, never a verdict: dynamic dispatch,
a same-named method on another class, or a string can all match.
"""
from __future__ import annotations

import json
import random
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO = Path("C:/Docker/aify-project-graph")
DB = REPO / ".aify-graph" / "graph.sqlite"
SEED = 20260925
SAMPLE = 25
CODE_GLOBS = ["*.js", "*.mjs", "*.cjs", "*.ts"]
# A definition line, not a call: `function f(`, `const f = (`, `f(x) {` as a method, `export function f(`.
DEFINITION = re.compile(
    r"(function\s*\*?\s+NAME\b|class\s+NAME\b|(const|let|var)\s+NAME\s*=|^\s*(async\s+)?(static\s+)?NAME\s*\([^)]*\)\s*\{|"
    r"^\s*NAME\s*[:=]\s*(async\s*)?(function|\()|export\s+\{[^}]*\bNAME\b)"
)


def git(*args: str) -> str:
    out = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return out.stdout


def rg_lines(name: str) -> list[tuple[str, int, str]]:
    """Every line in a code file containing the bare word, with its path and line number."""
    cmd = ["rg", "--no-heading", "--line-number", "--word-regexp", "--fixed-strings", name]
    for g in CODE_GLOBS:
        cmd += ["-g", g]
    out = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace")
    rows = []
    for line in out.stdout.splitlines():
        parts = line.split(":", 2)
        if len(parts) == 3 and parts[1].isdigit():
            rows.append((parts[0].replace("\\", "/"), int(parts[1]), parts[2]))
    return rows


def call_shaped(name: str) -> list[tuple[str, int, str]]:
    """Occurrences that look like a CALL: `name(` or `.name(`, excluding definition lines and comments."""
    defn = re.compile(DEFINITION.pattern.replace("NAME", re.escape(name)), re.M)
    call = re.compile(r"(?<![A-Za-z0-9_$])" + re.escape(name) + r"\s*\(")
    hits = []
    for path, line_no, text in rg_lines(name):
        stripped = text.strip()
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
            continue
        if defn.search(text):
            continue
        if call.search(text):
            hits.append((path, line_no, stripped[:120]))
    return hits


def main() -> None:
    head = git("rev-parse", "HEAD").strip()
    manifest = json.loads((REPO / ".aify-graph" / "manifest.json").read_text(encoding="utf-8"))
    indexed = str(manifest.get("commit", ""))
    print(f"FRESHNESS: graph indexed at {indexed[:10]}, HEAD {head[:10]} -> "
          f"{'SAME TREE' if indexed.startswith(head[:10]) or head.startswith(indexed[:10]) else 'DIFFERENT — sample is not this tree'}")

    db = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    q = """SELECT n.label, n.file_path, n.start_line FROM nodes n
           WHERE n.type IN ('Function','Method') AND n.file_path NOT LIKE 'tests/%'
             AND n.file_path NOT LIKE 'scripts/%' AND n.file_path NOT LIKE 'reference/%'
             AND @NOT@ EXISTS (SELECT 1 FROM edges e WHERE e.to_id = n.id AND e.relation = 'CALLS')"""
    zero = db.execute(q.replace("@NOT@", "NOT")).fetchall()
    called = db.execute(q.replace("@NOT@", "")).fetchall()
    print(f"POPULATION: {len(zero)} functions/methods with NO caller edge, {len(called)} with at least one "
          f"(non-test, non-script, non-reference files)")

    rng = random.Random(SEED)
    zero_sample = rng.sample(zero, min(SAMPLE, len(zero)))
    called_sample = rng.sample(called, min(10, len(called)))

    print(f"\nNEGATIVE CONTROL: fabricated name 'zzqNotARealSymbolHere' -> {len(call_shaped('zzqNotARealSymbolHere'))} call-shaped occurrences")
    pos_ok = sum(1 for label, _, _ in called_sample if call_shaped(label))
    print(f"POSITIVE CONTROL: {pos_ok} of {len(called_sample)} functions the graph says HAVE callers show call-shaped occurrences here")

    print(f"\nSAMPLE of {len(zero_sample)} zero-caller functions (seed {SEED}):")
    candidates = []
    for label, path, line in zero_sample:
        hits = [h for h in call_shaped(label) if not (h[0] == path and abs(h[1] - (line or 0)) <= 1)]
        mark = "CANDIDATE WRONG ZERO" if hits else "no call sites found — zero agrees"
        print(f"  {label:<34} {path}:{line}  {len(hits):>3} call-shaped  {mark}")
        if hits:
            candidates.append((label, path, line, hits[:3]))
    print(f"\nRESULT: {len(candidates)} of {len(zero_sample)} sampled zero-caller functions have call-shaped occurrences in code.")
    for label, path, line, hits in candidates:
        print(f"\n  {label} ({path}:{line})")
        for h in hits:
            print(f"    {h[0]}:{h[1]}  {h[2]}")


if __name__ == "__main__":
    main()
