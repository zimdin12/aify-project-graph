"""Positive control for pings.py: find functions whose text really changed W->HEAD, and one that did not, then
check ping() says S for the first and not for the second."""
import pings as p
rows = [l.split() for l in open("raw/boundaries.txt", encoding="utf-8") if l.strip()]
b = [p.Boundary(int(d), c) for d, c, *_ in rows]
w, h = b[0], b[-1]
changed_files = [f for f in p.git("diff", "--name-only", w.commit, h.commit, "--", "service/*.py").split() if f.endswith(".py")]
changed = same = None
for f in changed_files:
    for (label,) in w.db.execute("select label from nodes where file_path=? and type='Function'", (f,)).fetchall():
        ta, tb = p.symbol_text(w, label, f), p.symbol_text(h, label, f)
        if ta and tb and ta != tb and not changed: changed = (label, f)
        if ta and tb and ta == tb and not same: same = (label, f)
    if changed and same: break
print("changed", changed, "same", same)
for name, (label, f) in (("changed", changed), ("same", same)):
    feat = {"id": name, "anchors": {"symbols": [label], "files": [f]}}
    r = p.ping(feat, w, w, h)
    print(name, "S=", r["S"], "F=", r["F"], r["symbols"])
gone = {"id": "gone", "anchors": {"symbols": ["zzqNotASymbol"], "files": [changed[1]]}}
print("unresolvable", p.ping(gone, w, w, h)["unresolved_at_W"])
