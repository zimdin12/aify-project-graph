"""Test 4 pings (PROTOCOL-4.md). Read-only over the corpus and the per-boundary graphs.

For each feature in map/functionality.json and each slice (a, b):
  F: an anchored file's content differs between a and b, or the file is gone at b.
  S: an anchored symbol is gone at b, or the text of its line range (from each boundary's graph) differs.
Anchor identity is name-and-file: the node with that label in the anchored file, following git renames.
"""
from __future__ import annotations

import json
import sqlite3
import subprocess
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT.parent / "corpus"
CODE_TYPES = ("Function", "Method", "Class", "Symbol", "Interface", "Type")


class Boundary:
    """One commit with its APG graph."""

    def __init__(self, days: int, commit: str):
        self.days, self.commit = days, commit
        path = ROOT / "wt" / f"d{days}" / ".aify-graph" / "graph.sqlite"
        self.db = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)

    def ranges(self, label: str, file_path: str) -> list[tuple[int, int]]:
        marks = ",".join("?" * len(CODE_TYPES))
        rows = self.db.execute(
            f"SELECT start_line, end_line FROM nodes WHERE label = ? AND file_path = ? AND type IN ({marks})",
            (label, file_path, *CODE_TYPES)).fetchall()
        return sorted((int(s), int(e)) for s, e in rows if s and e)


def git(*args: str) -> str:
    out = subprocess.run(["git", *args], cwd=CORPUS, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode not in (0, 1):
        raise RuntimeError(f"git {' '.join(args)} -> {out.returncode}: {out.stderr[:300]}")
    return out.stdout


@lru_cache(maxsize=None)
def renames(a: str, b: str) -> dict[str, str]:
    out = {}
    for line in git("diff", "-M", "--name-status", a, b).splitlines():
        parts = line.split("\t")
        if parts and parts[0].startswith("R") and len(parts) == 3:
            out[parts[1]] = parts[2]
    return out


@lru_cache(maxsize=None)
def blob(commit: str, path: str) -> str | None:
    out = subprocess.run(["git", "show", f"{commit}:{path}"], cwd=CORPUS, capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    return out.stdout if out.returncode == 0 else None


def symbol_text(b: Boundary, label: str, path: str) -> str | None:
    """The concatenated text of every node with this label in this file at b, or None if there is none."""
    src = blob(b.commit, path)
    spans = b.ranges(label, path)
    if src is None or not spans:
        return None
    lines = src.splitlines()
    return "\n---\n".join("\n".join(lines[s - 1:e]) for s, e in spans)


def locate(feature: dict, w: Boundary, at: Boundary) -> dict[str, list[str]]:
    """For each anchored symbol, its file(s) at `at`: the W-defining anchored file, followed through renames."""
    moved = renames(w.commit, at.commit)
    out = {}
    for sym in feature["anchors"]["symbols"]:
        homes = [f for f in feature["anchors"]["files"] if w.ranges(sym, f)]
        out[sym] = [moved.get(f, f) for f in homes]
    return out


def ping(feature: dict, w: Boundary, a: Boundary, b: Boundary) -> dict:
    f_moved_a, f_moved_b = renames(w.commit, a.commit), renames(w.commit, b.commit)
    f_hits = []
    for f in feature["anchors"]["files"]:
        fa, fb = f_moved_a.get(f, f), f_moved_b.get(f, f)
        if blob(a.commit, fa) is None:
            continue
        if blob(b.commit, fb) != blob(a.commit, fa):
            f_hits.append(f)
    s_hits, unresolved = [], []
    homes_a, homes_b = locate(feature, w, a), locate(feature, w, b)
    for sym in feature["anchors"]["symbols"]:
        if not homes_a[sym]:
            unresolved.append(sym)
            continue
        ta = [symbol_text(a, sym, p) for p in homes_a[sym]]
        tb = [symbol_text(b, sym, p) for p in homes_b[sym]]
        if all(t is None for t in ta):
            continue
        if ta != tb:
            s_hits.append({"symbol": sym, "gone": all(t is None for t in tb)})
    return {"F": bool(f_hits), "S": bool(s_hits), "files": f_hits, "symbols": s_hits, "unresolved_at_W": unresolved}


def main() -> None:
    rows = [l.split() for l in (ROOT / "raw" / "boundaries.txt").read_text(encoding="utf-8").splitlines() if l.strip()]
    bounds = [Boundary(int(d), c) for d, c, *_ in rows]
    assert [b.days for b in bounds] == [28, 21, 14, 7, 0], [b.days for b in bounds]
    w = bounds[0]
    features = json.loads((ROOT / "map" / "functionality.json").read_text(encoding="utf-8"))["features"]

    # Controls first. Negative: a slice against itself must not ping anything.
    same = [ping(f, w, w, w) for f in features]
    assert not any(p["F"] or p["S"] for p in same), "negative control failed: W vs W pinged"
    unresolved = sorted({s for p in same for s in p["unresolved_at_W"]})
    report = {"features": len(features), "symbols": sum(len(f["anchors"]["symbols"]) for f in features),
              "symbols_unresolved_at_W": unresolved, "negative_control": "W vs W: 0 pings", "weekly": [], "per_feature": {}}

    for a, b in zip(bounds, bounds[1:]):
        results = {f["id"]: ping(f, w, a, b) for f in features}
        report["weekly"].append({"slice": f"d{a.days}->d{b.days}",
                                 "F": sum(r["F"] for r in results.values()),
                                 "S": sum(r["S"] for r in results.values())})
        for fid, r in results.items():
            report["per_feature"].setdefault(fid, {})[f"d{a.days}->d{b.days}"] = r
    cumulative = {f["id"]: ping(f, w, w, bounds[-1]) for f in features}
    for fid, r in cumulative.items():
        report["per_feature"][fid]["cumulative"] = r
    n = len(features)
    report["weekly_rate"] = {k: sum(s[k] for s in report["weekly"]) / (len(report["weekly"]) * n) for k in ("F", "S")}
    report["cumulative"] = {k: sum(r[k] for r in cumulative.values()) for k in ("F", "S")}
    (ROOT / "raw" / "pings.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "per_feature"}, indent=1))


if __name__ == "__main__":
    main()
