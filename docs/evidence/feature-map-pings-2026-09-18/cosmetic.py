"""POST HOC, not deciding: of the S pings, how many are comment/whitespace-only changes."""
import json, re
import pings as p
JS = re.compile(r"/\*.*?\*/|//[^\n]*", re.S); PY = re.compile(r"(^|\s)#[^\n]*")
def norm(t, path):
    if t is None: return None
    t = (PY if path.endswith(".py") else JS).sub(" ", t)
    return re.sub(r"\s+", "", t)
rows = [l.split() for l in open("raw/boundaries.txt", encoding="utf-8") if l.strip()]
b = [p.Boundary(int(d), c) for d, c, *_ in rows]; w = b[0]
feats = json.load(open("map/functionality.json", encoding="utf-8"))["features"]
out = {}
for a, z in zip(b, b[1:]):
    real = cosmetic = 0
    for f in feats:
        ha, hz = p.locate(f, w, a), p.locate(f, w, z)
        kinds = []
        for s in f["anchors"]["symbols"]:
            ta = [norm(p.symbol_text(a, s, x), x) for x in ha[s]]; tz = [norm(p.symbol_text(z, s, x), x) for x in hz[s]]
            raw_a = [p.symbol_text(a, s, x) for x in ha[s]]; raw_z = [p.symbol_text(z, s, x) for x in hz[s]]
            if raw_a != raw_z and any(t is not None for t in raw_a): kinds.append(ta != tz)
        if kinds: real += any(kinds); cosmetic += not any(kinds)
    out[f"d{a.days}->d{z.days}"] = {"S_real": real, "S_cosmetic_only": cosmetic}
print(json.dumps(out, indent=1))
