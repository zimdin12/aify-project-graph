import sys; sys.path.insert(0, '.')
import re, detect_v3 as d
OLD = d.git("rev-list","-n","1","--before=2026-08-15",d.HEAD).strip()
dele = [l.split("\t")[1] for l in d.git("diff","--name-status","--diff-filter=D",OLD,d.HEAD).splitlines() if l.split("\t")[1].endswith((".js",".mjs")) and not d.NON_PROD.search(l.split("\t")[1])]
print(dele)
for f in dele:
    src = d.git("show", f"{OLD}:{f}")
    for g in re.findall(r"import\s*\{([^}]*)\}", src):
        for n in g.split(","):
            t = n.strip().split(" as ")[0].strip()
            if not d.IDENT.match(t): continue
            dt = d.defining_files(t, OLD); dn = d.defining_files(t, d.HEAD)
            b = d.code_referrers(t, OLD, dt); a = d.code_referrers(t, d.HEAD, dn) if dn else ()
            print(f, t, "defs", dt, "->", dn, "| refs then", len(b), "now", len(a), list(a)[:3])
