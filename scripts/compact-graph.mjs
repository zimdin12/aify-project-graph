#!/usr/bin/env node
// Reclaim disk on a graph whose code_intel_records bloated across many clangd
// collection runs (the unbounded-growth bug fixed in the importer's per-collect
// auto-prune). Keeps only the latest collection per provider, prunes the rest,
// then VACUUMs so the file actually shrinks.
//
// Usage: node scripts/compact-graph.mjs <repoRoot|graph.sqlite path> [--delete-envelopes]
//   node scripts/compact-graph.mjs C:/Users/Administrator/sand_castle
//
// Safe: superseded collections are stale (getLatestCollection / replay only ever
// read the latest), so pruning them changes no query answer — it only removes
// dead side-table rows and reclaims space. The graph (nodes/edges, incl. the
// LSP-verified edges synthesized from the latest collection) is untouched.
//
// It also REPORTS leftover on-disk collection envelopes (`code-intel-*.json`).
// Measured on sand_castle: ~450 MB of them, including one 353 MB file, beside an
// 864 MB graph.sqlite. These are inputs that were already imported into the DB,
// so they are dead weight once a collection is stored — but they are the user's
// files, so this only DELETES them when you pass --delete-envelopes.

import { statSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { openExistingDb } from '../mcp/stdio/storage/db.js';
import { compactCodeIntelRecords } from '../mcp/stdio/ingest/code-intel/importer.js';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/compact-graph.mjs <repoRoot | path/to/graph.sqlite>');
  process.exit(2);
}
const dbPath = basename(arg) === 'graph.sqlite' ? arg : join(arg, '.aify-graph', 'graph.sqlite');

const sizeMB = (p) => { try { return (statSync(p).size / 1048576).toFixed(1); } catch { return '?'; } };

const before = sizeMB(dbPath);
const db = openExistingDb(dbPath, { readonly: false });
try {
  const recordsBefore = db.get('SELECT COUNT(*) AS c FROM code_intel_records').c;
  const collectionsBefore = db.get('SELECT COUNT(*) AS c FROM code_intel_collections').c;
  console.log(`graph: ${dbPath}`);
  console.log(`before: ${before} MB · ${collectionsBefore} collections · ${recordsBefore} records`);

  const res = compactCodeIntelRecords(db);
  console.log(`pruned: ${res.collectionsPruned} superseded collection(s), ${res.recordsPruned} record(s)`);
  console.log(`kept:   ${res.kept.join(', ') || '(none)'}`);

  // Checkpoint the WAL then VACUUM so the file shrinks on disk.
  try { db.run('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* not in WAL — fine */ }
  console.log('vacuuming…');
  db.run('VACUUM');

  const recordsAfter = db.get('SELECT COUNT(*) AS c FROM code_intel_records').c;
  console.log(`after:  ${sizeMB(dbPath)} MB · ${db.get('SELECT COUNT(*) AS c FROM code_intel_collections').c} collections · ${recordsAfter} records`);
} finally {
  db.close();
}

// On-disk collection envelopes: already imported into the DB, so they are dead
// weight — but they are the user's files. Report by default; delete only on
// explicit opt-in.
const graphDir = join(dbPath, '..');
try {
  const envelopes = readdirSync(graphDir)
    .filter((f) => /^code-intel.*\.json$/i.test(f))
    .map((f) => {
      const p = join(graphDir, f);
      let size = 0;
      try { size = statSync(p).size; } catch { /* ignore */ }
      return { name: f, path: p, size };
    })
    .sort((a, b) => b.size - a.size);

  if (envelopes.length) {
    const totalMB = (envelopes.reduce((s, e) => s + e.size, 0) / 1048576).toFixed(1);
    console.log(`\nleftover collection envelopes: ${envelopes.length} file(s), ${totalMB} MB`);
    for (const e of envelopes.slice(0, 5)) {
      console.log(`  ${(e.size / 1048576).toFixed(1).padStart(7)} MB  ${e.name}`);
    }
    if (envelopes.length > 5) console.log(`  … and ${envelopes.length - 5} more`);

    if (process.argv.includes('--delete-envelopes')) {
      let removed = 0;
      for (const e of envelopes) {
        try { unlinkSync(e.path); removed += 1; } catch (err) { console.error(`  could not remove ${e.name}: ${err.message}`); }
      }
      console.log(`deleted ${removed}/${envelopes.length} envelope(s), reclaiming ~${totalMB} MB`);
    } else {
      console.log('  (these were already imported into the DB — re-run with --delete-envelopes to remove them)');
    }
  }
} catch { /* best-effort */ }
