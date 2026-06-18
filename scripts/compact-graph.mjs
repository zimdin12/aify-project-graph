#!/usr/bin/env node
// Reclaim disk on a graph whose code_intel_records bloated across many clangd
// collection runs (the unbounded-growth bug fixed in the importer's per-collect
// auto-prune). Keeps only the latest collection per provider, prunes the rest,
// then VACUUMs so the file actually shrinks.
//
// Usage: node scripts/compact-graph.mjs <repoRoot|graph.sqlite path>
//   node scripts/compact-graph.mjs C:/Users/Administrator/sand_castle
//
// Safe: superseded collections are stale (getLatestCollection / replay only ever
// read the latest), so pruning them changes no query answer — it only removes
// dead side-table rows and reclaims space. The graph (nodes/edges, incl. the
// LSP-verified edges synthesized from the latest collection) is untouched.

import { statSync } from 'node:fs';
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
