#!/usr/bin/env node
// Rebuild the LSP trust spine from `code_intel_records` that are already stored.
//
// ⛔ WHY THIS IS A RECOVERY AND NOT A RE-COLLECT: the records ARE the evidence. Edges are
// synthesized from them, so a graph holding 166,992 records and 814 edges has not lost anything —
// it has lost the derived layer. Re-collecting would spend a quarter of an hour asking the language
// server questions we already have the answers to.
//
// ⚠ It is additive by construction. `resynthesizeLspEdgesFromCollection` builds an envelope with no
// `operations` block, so `collectionAuthority` withholds `mayInvalidateEdges` and nothing is
// deleted. That is what makes it safe to run across several collections in sequence — which is the
// exact thing that destroyed the spine when the COLLECTOR did it without declaring scope.
//
//   node scripts/resynthesize-spine.mjs
import { resynthesizeLspEdgesFromCollection } from '../mcp/stdio/ingest/code-intel/importer.js';
import { openDb } from '../mcp/stdio/storage/db.js';
import { join } from 'node:path';

const repoRoot = process.cwd();
const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
const count = (s) => db.get(s).c;

const before = {
  edges: count("SELECT COUNT(*) c FROM edges WHERE provenance='LSP_VERIFIED'"),
  records: count('SELECT COUNT(*) c FROM code_intel_records'),
};
console.log(`before  lspEdges=${before.edges} records=${before.records}`);

const collections = db.all(
  `SELECT c.collection_id AS id, c.provider, c.status,
          (SELECT COUNT(*) FROM code_intel_records r WHERE r.collection_id = c.collection_id) AS records
     FROM code_intel_collections c ORDER BY c.collected_at`,
);

let restored = 0;
for (const c of collections) {
  if (c.records === 0) {
    // Reported, not skipped silently: a collection with no records is exactly the state that
    // started this whole sequence, and it should be visible rather than absent from the log.
    console.log(`  ${c.id.slice(0, 34)}  ${String(c.status).padEnd(7)} records=0  (nothing to restore)`);
    continue;
  }
  const t0 = Date.now();
  const s = resynthesizeLspEdgesFromCollection(db, { collectionId: c.id });
  restored += s.edgesCreated ?? 0;
  console.log(`  ${c.id.slice(0, 34)}  ${String(c.status).padEnd(7)} records=${c.records}`
    + `  edges+${s.edgesCreated ?? 0} nodes+${s.nodesCreated ?? 0}`
    + `  invalidated=${s.edgesInvalidated ?? 0}  ${Math.round((Date.now() - t0) / 1000)}s`);
  // ⛔ THE ASSERTION THAT MATTERS, CHECKED EVERY ITERATION RATHER THAN AT THE END. If any pass
  // invalidates, a later collection is deleting an earlier one's edges and the total will look
  // fine while the composition is wrong — which is precisely how this damage went unnoticed.
  if ((s.edgesInvalidated ?? 0) > 0) {
    console.log('    ⛔ STOP: this pass INVALIDATED edges. Re-synthesis must be additive.');
    break;
  }
}

const after = count("SELECT COUNT(*) c FROM edges WHERE provenance='LSP_VERIFIED'");
console.log(`\nafter   lspEdges=${after}  (created ${restored} across ${collections.length} collection(s))`);
db.close();
