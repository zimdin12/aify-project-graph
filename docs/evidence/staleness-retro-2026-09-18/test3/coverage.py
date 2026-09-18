import sys, re, collections; sys.path.insert(0, '.')
import detect_v3 as d
pop = [p for p in open("raw/population.txt", encoding="utf-8").read().split() if p.endswith(".md")]
kinds = collections.Counter(); verbs = collections.Counter()
for doc in pop:
    for line in d.git("show", f"{d.HEAD}:{doc}").splitlines():
        for t in d.TICK.findall(line):
            t = t.strip().strip("()")
            if d.PATHLIKE.match(t): kinds["pathlike"] += 1
            elif d.IDENT.match(t):
                kinds["identlike"] += 1
                if re.match(r"^(graph|code_intel)_", t): verbs[t] += 1
            else: kinds["other"] += 1
print(dict(kinds)); print("tool-verb tokens", sum(verbs.values()), "distinct", len(verbs))
print("verb names defined by the definition patterns at HEAD:", sum(bool(d.defining_files(v, d.HEAD)) for v in verbs), "of", len(verbs))
