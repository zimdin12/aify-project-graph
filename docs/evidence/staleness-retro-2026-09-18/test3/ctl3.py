import sys; sys.path.insert(0, '.')
import re, detect_v3 as d
log = d.git("log","--diff-filter=D","--name-only","--format=@%H",d.HEAD,"--","*.js","*.mjs")
events, cur = [], None
for l in log.splitlines():
    if l.startswith("@"): cur = l[1:]
    elif l.strip() and not d.NON_PROD.search(l): events.append((cur, l.strip()))
print("deletion events", len(events))
hits = {"S3a":[], "S4a":[]}; tried = 0
for c, f in events[:60]:
    old = c + "^"
    old = d.git("rev-parse", old).strip()
    src = d.git("show", f"{old}:{f}")
    toks = {n.strip().split(" as ")[0].strip() for g in re.findall(r"import\s*\{([^}]*)\}", src) for n in g.split(",")}
    toks |= set(re.findall(r"from\s+['\"]\.{1,2}/[^'\"]*?([A-Za-z0-9_-]+\.m?js)['\"]", src))
    for t in sorted(toks):
        if not (d.IDENT.match(t) or d.PATHLIKE.match(t)): continue
        tried += 1
        r = d.evaluate(t, old)
        if r and r.get("rule") in hits: hits[r["rule"]].append((t, f, c[:10], r))
print("tried", tried)
for k, v in hits.items():
    print(k, len(v))
    for h in v[:6]: print("  ", str(h)[:260])
