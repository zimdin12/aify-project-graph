// DID THE RESOLVER SPEEDUP CHANGE THE GRAPH?
//
// A performance fix in the resolver is only acceptable if it produces the SAME graph. The unit suite
// covers resolution behaviour, but it is a different substrate from a real 880-file repository, and
// this project's record is that a second reader of the same substrate confirms the wrong noun.
//
// ⛔ THE COMPARISON IS SEMANTIC, NOT ROW-IDENTICAL. Node ids are not stable across rebuilds, so
// hashing them would report a difference on every run and prove nothing. Edges are projected to
// (from label + file, relation, to label + file) and sorted, which is the content a caller actually
// sees.
//
// USAGE:
//   node scripts/probe-resolver-equivalence.mjs --snapshot <repo>   # hash the graph as it stands
//   node scripts/probe-resolver-equivalence.mjs --rebuild  <repo>   # force rebuild, then hash
//
// Run --snapshot with the OLD code's graph in place, then --rebuild with the NEW code, and compare.
// Same clone, same working tree, only the code differs.
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const mode = process.argv[2];
const repo = process.argv[3];
if (!['--snapshot', '--rebuild'].includes(mode) || !repo) {
  console.error('usage: probe-resolver-equivalence.mjs --snapshot|--rebuild <repoRoot>');
  process.exit(64);
}

const { openExistingDb } = await import('../mcp/stdio/storage/db.js');
const dbPath = join(repo, '.aify-graph', 'graph.sqlite');

if (mode === '--rebuild') {
  const { ensureFresh } = await import('../mcp/stdio/freshness/orchestrator.js');
  const t = Date.now();
  await ensureFresh({ repoRoot: repo, force: true });
  console.log('rebuild ms: ' + (Date.now() - t));
}

const db = openExistingDb(dbPath);
try {
  const nodes = db.get("SELECT COUNT(*) AS c FROM nodes")?.c ?? 0;
  const files = db.get("SELECT COUNT(*) AS c FROM nodes WHERE type = 'File'")?.c ?? 0;
  const edges = db.get('SELECT COUNT(*) AS c FROM edges')?.c ?? 0;

  const rows = db.all(`
    SELECT f.label AS fl, f.file_path AS ff, e.relation AS rel, t.label AS tl, t.file_path AS tf
    FROM edges e
    JOIN nodes f ON f.id = e.from_id
    JOIN nodes t ON t.id = e.to_id
  `);
  const projected = rows
    .map((r) => `${r.ff ?? ''}|${r.fl ?? ''}|${r.rel ?? ''}|${r.tf ?? ''}|${r.tl ?? ''}`)
    .sort();
  const hash = createHash('sha256').update(projected.join('\n')).digest('hex').slice(0, 16);

  console.log(`nodes=${nodes} files=${files} edges=${edges}`);
  console.log(`edge-content sha256/16 = ${hash}`);

  // APG_DUMP=<path> writes the projected edge set so two runs can be diffed line by line. A hash
  // says THAT something changed; only the projection says WHAT, and a behaviour change you cannot
  // enumerate is one you cannot defend.
  if (process.env.APG_DUMP) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.APG_DUMP, projected.join('\n') + '\n');
    const types = db.all("SELECT type, COUNT(*) AS c FROM nodes GROUP BY type ORDER BY type");
    writeFileSync(process.env.APG_DUMP + '.types', types.map((t) => `${t.type} ${t.c}`).join('\n') + '\n');
    console.log(`dumped ${projected.length} projected edges to ${process.env.APG_DUMP}`);
  }
} finally {
  db.close?.();
}
