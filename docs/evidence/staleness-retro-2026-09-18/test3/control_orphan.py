"""Positive controls for S3a and S4a, run after the population result showed zero for both.

Search the corpus history for a real orphaning event instead of trusting the zero: take files deleted since an
old commit, and for every symbol and file they used, ask evaluate() at that old commit. A rule that never fires
on this set is not proven to work.
"""
import json
import re

import detect_v3 as d

OLD = d.git("rev-list", "-n", "1", "--before=2026-08-15", d.HEAD).strip()
deleted = [l.split("\t")[1] for l in d.git("diff", "--name-status", "--diff-filter=D", OLD, d.HEAD).splitlines()
           if l.split("\t")[1].endswith((".js", ".mjs"))]
deleted = [f for f in deleted if not d.NON_PROD.search(f)]
print("OLD", OLD[:10], "deleted prod js files", len(deleted))
fired = {"S3a": [], "S4a": []}
tried = 0
for f in deleted:
    src = d.git("show", f"{OLD}:{f}")
    names = set(re.findall(r"import\s*\{([^}]*)\}", src))
    idents = {n.strip().split(" as ")[0].strip() for group in names for n in group.split(",") if n.strip()}
    paths = set(re.findall(r"from\s+['\"]\.{1,2}/[^'\"]*?([A-Za-z0-9_-]+\.m?js)['\"]", src))
    for tok in sorted(idents | paths):
        if not (d.IDENT.match(tok) or d.PATHLIKE.match(tok)):
            continue
        tried += 1
        r = d.evaluate(tok, OLD)
        if r and r.get("rule") in fired:
            fired[r["rule"]].append({"token": tok, "via": f, **r})
print("tokens tried", tried)
for rule, hits in fired.items():
    print(rule, len(hits))
    for h in hits[:5]:
        print("  ", json.dumps(h)[:300])
