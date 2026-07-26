// scripts/dump-graph.mjs
//
// Deterministic graph dump for equivalence checking. Any change that is supposed
// to be behaviour-preserving (a refactor, a perf pass, a parser swap) can be
// gated on a byte-identical dump:
//
//   node scripts/dump-graph.mjs <repo> > before.dump
//   ...make the change, reindex...
//   node scripts/dump-graph.mjs <repo> > after.dump
//   diff before.dump after.dump        # empty == provably no semantic drift
//
// Rows are emitted by NATURAL KEY and sorted lexicographically, which removes
// rowid/insertion-order nondeterminism while preserving every semantic field.
// Volatile columns are excluded ON PURPOSE and listed here so the exclusion is
// auditable rather than accidental:
//
//   - rowid / autoincrement ids   — insertion order, not meaning
//   - imported_at / collected_at  — wall-clock timestamps
//
// A small diff is a REAL finding, not noise: the point is that a 13-edge
// difference is visible instead of drowned in reordering.
//
//   --hash   print a single sha256 instead of the rows (for large repos / CI)
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openExistingDb } from '../mcp/stdio/storage/db.js';

// Piping into `head`/`Select-Object -First N` closes stdout early; that is normal
// usage for a dump tool, not an error. Without this, Node throws EPIPE.
process.stdout.on('error', (err) => { if (err?.code === 'EPIPE') process.exit(0); throw err; });

const repoRoot = process.argv[2] || process.cwd();
const hashOnly = process.argv.includes('--hash');
const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');

if (!existsSync(dbPath)) {
  console.error(`no graph at ${dbPath} — run graph_index first`);
  process.exit(2);
}

const db = openExistingDb(dbPath);
const lines = [];

try {
  // NODES — keyed by (type, file_path, label, start_line). `extra` is included
  // because it carries semantic payload (qname, kind, captured sources).
  for (const n of db.all(
    `SELECT type, label, file_path, start_line, end_line, language, confidence, extra
       FROM nodes
      ORDER BY type, file_path, label, start_line`,
  )) {
    lines.push(`N\t${JSON.stringify(n)}`);
  }

  // EDGES — keyed by both endpoints' identity rather than internal ids, so a
  // reindex that renumbers rows still compares equal.
  for (const e of db.all(
    `SELECT src.type AS from_type, src.label AS from_label, src.file_path AS from_file,
            tgt.type AS to_type,  tgt.label AS to_label,  tgt.file_path AS to_file,
            e.relation, e.source_file, e.source_line, e.confidence, e.provenance, e.extractor
       FROM edges e
       JOIN nodes src ON src.id = e.from_id
       JOIN nodes tgt ON tgt.id = e.to_id
      ORDER BY from_file, from_label, relation, to_file, to_label, source_line`,
  )) {
    lines.push(`E\t${JSON.stringify(e)}`);
  }

  // FILES — the indexed surface. A file appearing/disappearing is exactly the
  // kind of silent coverage change this oracle exists to catch.
  for (const f of db.all(
    `SELECT DISTINCT file_path FROM nodes WHERE type = 'File' ORDER BY file_path`,
  )) {
    lines.push(`F\t${f.file_path}`);
  }
} finally {
  db.close();
}

const body = lines.join('\n') + '\n';
if (hashOnly) {
  const counts = lines.reduce((acc, l) => {
    const k = l[0];
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`${createHash('sha256').update(body).digest('hex')}  nodes=${counts.N ?? 0} edges=${counts.E ?? 0} files=${counts.F ?? 0}`);
} else {
  process.stdout.write(body);
}
