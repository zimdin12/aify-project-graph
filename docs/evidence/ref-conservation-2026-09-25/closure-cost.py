"""What does making the expansion deletion-closed cost, on the real graph?

One level: the changed file plus the owners of edges pointing into it.
Fixed point: repeat until no new owners appear — which is what correctness requires, because every
file re-extracted has ITS incoming edges destroyed too.

Reports both sizes for a sample of real files, so the cost is a measurement rather than a worry.
"""
import sqlite3
import random
import statistics

DB = 'C:/Docker/aify-project-graph/.aify-graph/graph.sqlite'
SEED = 20260926
SAMPLE = 40

db = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)

nodes_by_file = {}
for fp, nid in db.execute("SELECT file_path, id FROM nodes WHERE file_path <> ''"):
    nodes_by_file.setdefault(fp, []).append(nid)

# owners[file] = the set of files owning an edge pointing INTO that file's nodes
owners = {}
for fp, ids in nodes_by_file.items():
    marks = ','.join('?' * len(ids))
    rows = db.execute(
        f"SELECT DISTINCT source_file FROM edges WHERE to_id IN ({marks}) AND source_file != ''", ids)
    owners[fp] = {r[0] for r in rows if r[0] != fp}

CODE = [f for f in nodes_by_file if f.endswith(('.js', '.mjs', '.cjs', '.ts'))]
print(f"files with nodes: {len(nodes_by_file)}, of which code: {len(CODE)}")


def one_level(start):
    return {start} | owners.get(start, set())


def fixed_point(start):
    seen = {start}
    queue = [start]
    while queue:
        f = queue.pop()
        for o in owners.get(f, ()):
            if o not in seen:
                seen.add(o)
                queue.append(o)
    return seen


rng = random.Random(SEED)
sample = rng.sample(CODE, min(SAMPLE, len(CODE)))
rows = []
for f in sample:
    a, b = len(one_level(f)), len(fixed_point(f))
    rows.append((b - a, a, b, f))

rows.sort(reverse=True)
print(f"\nsample of {len(rows)} code files (seed {SEED}), sorted by added files:")
print(f"{'one-level':>10}{'fixed-point':>13}{'added':>8}  file")
for added, a, b, f in rows[:15]:
    print(f"{a:>10}{b:>13}{added:>8}  {f}")

ones = [a for _, a, _, _ in rows]
fixes = [b for _, _, b, _ in rows]
print(f"\none-level:   median {statistics.median(ones):.0f}, mean {statistics.mean(ones):.1f}, max {max(ones)}")
print(f"fixed-point: median {statistics.median(fixes):.0f}, mean {statistics.mean(fixes):.1f}, max {max(fixes)}")
print(f"worst case as a share of all {len(nodes_by_file)} files with nodes: {max(fixes) / len(nodes_by_file):.1%}")
unchanged = sum(1 for added, _, _, _ in rows if added == 0)
print(f"files where the closure adds NOTHING: {unchanged} of {len(rows)}")
