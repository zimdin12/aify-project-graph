#!/usr/bin/env node
// Reset the code-intel layer of a graph: LSP-synthesized edges, the collection
// side-tables, and the resume ledger. Leaves the structural graph (tree-sitter
// nodes/edges, overlay, briefs) completely untouched.
//
// WHY THIS EXISTS. Clearing `.aify-graph/code-intel/collect-progress.json` removes
// the record of WHICH files were collected — it does not remove the RECORDS
// THEMSELVES from the graph DB. sc-manager hit exactly that on 2026-07-30: he
// cleared the ledger after the wrong-symbol reference explosion, and 1,618,718
// contaminated references were still imported and still being served. His words:
// "I removed the index of the bad thing and left the bad thing."
//
// It is not recoverable by re-collecting, either. Edge invalidation and record
// pruning are gated on `envelope.status === 'ok'`, and a budget-limited resumed
// collection returns `partial` on every call — so a fresh sequence ACCUMULATES
// alongside the bad data rather than replacing it.
//
// Usage:
//   node scripts/reset-code-intel.mjs <repoRoot> [--dry-run] [--yes]
//
// Prints what it will remove and requires --yes to proceed, because deleting graph
// state on someone else's repo should never be a silent side effect.

import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openExistingDb } from '../mcp/stdio/storage/db.js';
import { ledgerPath } from '../mcp/stdio/code-intel/collect-ledger.js';

const args = process.argv.slice(2);
const repoRoot = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const dryRun = args.includes('--dry-run');
const confirmed = args.includes('--yes');

const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
if (!existsSync(dbPath)) {
  console.error(`no graph at ${dbPath}`);
  process.exit(1);
}

const db = openExistingDb(dbPath, { readonly: false });
try {
  const count = (sql) => { try { return db.get(sql).c; } catch { return 0; } };

  // Only clangd-synthesized edges. A hand-authored or tree-sitter edge is not
  // ours to delete, and LSP_VERIFIED rows carrying a `|was:` stash are PROMOTED
  // heuristic edges whose origin must be restored rather than dropped.
  const edges = count(
    "SELECT COUNT(*) AS c FROM edges WHERE provenance='LSP_VERIFIED' AND extractor LIKE 'cpp-clangd#%'");
  const promoted = count(
    "SELECT COUNT(*) AS c FROM edges WHERE provenance='LSP_VERIFIED' AND extractor LIKE '%|was:%'");
  const records = count('SELECT COUNT(*) AS c FROM code_intel_records');
  const collections = count('SELECT COUNT(*) AS c FROM code_intel_collections');
  const ledgerExists = existsSync(ledgerPath(repoRoot));

  console.log(`repo:              ${repoRoot}`);
  console.log(`LSP_VERIFIED edges (cpp-clangd, synthesized): ${edges}`);
  console.log(`  of which PROMOTED heuristic edges (restored, not deleted): ${promoted}`);
  console.log(`code_intel_records:      ${records}`);
  console.log(`code_intel_collections:  ${collections}`);
  console.log(`resume ledger present:   ${ledgerExists}`);
  console.log('structural graph (nodes, non-LSP edges, overlay, briefs): UNTOUCHED');

  if (dryRun || !confirmed) {
    console.log(dryRun ? '\n--dry-run: nothing removed.' : '\nRe-run with --yes to remove the above.');
    process.exit(0);
  }

  db.exec('BEGIN');
  try {
    // Restore promoted edges to their heuristic origin before deleting the rest,
    // mirroring the importer. Dropping them outright would silently lose real
    // tree-sitter edges that clangd had merely upgraded.
    const stashed = db.all(
      "SELECT from_id, to_id, relation, extractor FROM edges WHERE provenance='LSP_VERIFIED' AND extractor LIKE '%|was:%'");
    for (const row of stashed) {
      const origin = String(row.extractor).split('|was:')[1] ?? '';
      const [prov, extractor, conf] = origin.split('|');
      if (!prov) continue;
      db.run(
        `UPDATE edges SET provenance=$p, extractor=$e, confidence=$c
          WHERE from_id=$f AND to_id=$t AND relation=$r`,
        { p: prov, e: extractor ?? '', c: Number(conf) || 0.5, f: row.from_id, t: row.to_id, r: row.relation });
    }
    db.run("DELETE FROM edges WHERE provenance='LSP_VERIFIED' AND extractor LIKE 'cpp-clangd#%' AND extractor NOT LIKE '%|was:%'");
    db.run("DELETE FROM nodes WHERE id LIKE 'ci:lsp:%' AND id NOT IN (SELECT from_id FROM edges UNION SELECT to_id FROM edges)");
    try { db.run('DELETE FROM code_intel_records'); } catch { /* table may not exist */ }
    try { db.run('DELETE FROM code_intel_collections'); } catch { /* table may not exist */ }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  if (ledgerExists) rmSync(ledgerPath(repoRoot), { force: true });
  console.log('\ncode-intel layer reset. Run a fresh graph_collect_code_intel from zero.');
} finally {
  db.close();
}
