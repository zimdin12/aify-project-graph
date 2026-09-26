import sqlite3
import sys


def imports(path):
    db = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
    rows = db.execute(
        "SELECT e.source_file, e.source_line, n.file_path FROM edges e "
        "JOIN nodes n ON n.id=e.to_id WHERE e.relation='IMPORTS'").fetchall()
    db.close()
    # Key on (importer, imported file). source_line is dropped: edges are deduplicated on
    # (from,to,relation) so only one line survives per pair, and it need not be the same one.
    return {(r[0], r[2]) for r in rows}


full = imports(sys.argv[1])
inc = imports(sys.argv[2])
only_full = sorted(full - inc)
only_inc = sorted(inc - full)

print(f"IMPORTS pairs: full {len(full)}, incremental {len(inc)}")
print(f"\nMISSING FROM THE INCREMENTAL GRAPH ({len(only_full)}):")
for importer, imported in only_full:
    print(f"  {importer}\n      -> {imported}")
print(f"\nONLY IN THE INCREMENTAL GRAPH ({len(only_inc)}):")
for importer, imported in only_inc:
    print(f"  {importer}\n      -> {imported}")

exts = {}
for _, imported in only_full:
    ext = imported[imported.rfind('.'):] if '.' in imported else '(none)'
    exts[ext] = exts.get(ext, 0) + 1
print(f"\nmissing by imported-file extension: {exts}")
importers = {}
for importer, _ in only_full:
    top = importer.split('/')[0]
    importers[top] = importers.get(top, 0) + 1
print(f"missing by importer top-level dir: {importers}")
