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
// These are inputs already imported into the DB, so they are dead weight once a
// collection is stored — but they are the user's files, so this only DELETES
// them when you pass --delete-envelopes.
//
// ⚠ THE JUSTIFICATION FOR THAT DESTRUCTIVE FLAG IS MEASURED AT RUN TIME, NOT QUOTED FROM A
// COMMENT. This header used to read "Measured on sand_castle: ~450 MB of them, including one
// 353 MB file, beside an 864 MB graph.sqlite". By 2026-08-20 that repo had NO envelopes left at
// all and a 1.07 GB graph — someone had cleaned them in between (ef-manager, checking the claim
// rather than believing it). So a reader deciding whether to pass a flag that DELETES THEIR FILES
// was being sold it by a number that no longer held.
//
// A measured claim in a header ages exactly like a citation. The figures above are gone rather
// than updated, because updating them just restarts the clock; the script prints the actual
// footprint it found before it offers to remove anything, so the case for deleting is made from
// what is true at the moment of the decision.

import { statSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { openExistingDb, vacuumWithIncrementalUpgrade } from '../mcp/stdio/storage/db.js';
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

  // Checkpoint the WAL, then VACUUM so the file shrinks on disk — AND convert the file to
  // incremental auto-vacuum while we are here.
  //
  // ⛔ This script used to run a bare VACUUM. That reclaims the space and leaves the file
  // on auto_vacuum=NONE, free to re-accumulate the same high-water mark: sand_castle came
  // back 2.87 GB -> 36.4 MB with the mode still 0, and reported it. The pragma is inert on
  // a populated database on its own — it records an intent the next VACUUM on the SAME
  // CONNECTION carries out — so the two only work as a pair. Fixing the symptom while
  // leaving the cause is the thing this repo keeps promising not to do.
  console.log('vacuuming…');
  const mode = vacuumWithIncrementalUpgrade(db);
  // Report the mode rather than announcing success: the whole reason this defect reached a
  // user is that the failed half was invisible.
  console.log(`auto_vacuum: ${mode === 2 ? 'INCREMENTAL (this file can now reclaim in place)' : `${mode} — UPGRADE DID NOT TAKE`}`);

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
