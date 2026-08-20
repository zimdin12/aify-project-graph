#!/usr/bin/env node
// Drive a code-intel collection to convergence, one resumed batch at a time.
//
// ⛔ WHY THIS EXISTS RATHER THAN "just run collect": a repo larger than the provider's file cap is
// collected as a SEQUENCE, and the single-call surface reports each batch as its own success. A
// caller reading one response cannot tell "this repo is covered" from "the first 200 files are".
// This loop is the thing that can tell the difference, because it is the only party that sees
// every batch.
//
// It prints one line per batch and stops on convergence, on no forward progress, or on a batch
// that reports error — never on a fixed batch count, which would be a cap reported as a total for
// the fifth time in this codebase.
//
//   node scripts/recollect-until-converged.mjs [language] [--budget-ms N] [--max-batches N]
import { graphCollectCodeIntel } from '../mcp/stdio/query/verbs/collect_code_intel.js';
import { openDb } from '../mcp/stdio/storage/db.js';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const language = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || 'typescript';
const budgetMs = flag('budget-ms', 600_000);
// A ceiling on batches, not a target. Hitting it is REPORTED as unconverged, never as done.
const maxBatches = flag('max-batches', 40);
const repoRoot = process.cwd();

function graphState() {
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const c = (s) => db.get(s).c;
    return {
      records: c('SELECT COUNT(*) c FROM code_intel_records'),
      collections: c('SELECT COUNT(*) c FROM code_intel_collections'),
      lspEdges: c("SELECT COUNT(*) c FROM edges WHERE provenance='LSP_VERIFIED'"),
      refNodes: c("SELECT COUNT(*) c FROM nodes WHERE file_path LIKE 'reference/%'"),
    };
  } finally { try { db.close(); } catch { /* best effort */ } }
}

const before = graphState();
console.log(`start  records=${before.records} collections=${before.collections} `
  + `lspEdges=${before.lspEdges} referenceNodes=${before.refNodes}`);

let converged = false;
let batches = 0;
let lastRecords = before.records;
for (; batches < maxBatches; batches += 1) {
  const t0 = Date.now();
  const r = await graphCollectCodeIntel({ repoRoot, language, scope: 'all', budgetMs });
  const s = r.session ?? r.index ?? {};
  const now = graphState();
  console.log(
    `batch ${String(batches + 1).padStart(2)}  status=${r.status} `
    + `processed=${s.filesProcessed ?? '?'} resumedFrom=${s.resumedFrom ?? '?'} `
    + `of ${s.enumeratedTotal ?? '?'}  records=${now.records} (+${now.records - lastRecords}) `
    + `lspEdges=${now.lspEdges}  ${Math.round((Date.now() - t0) / 1000)}s`
    + (r.pruneSkipped || r.stats?.pruneSkipped ? '  [prune declined]' : ''),
  );
  if (r.status === 'error') {
    console.log(`STOP: batch reported error — ${JSON.stringify(r.errors ?? []).slice(0, 300)}`);
    break;
  }
  // ⛔ THIS SCRIPT BELIEVED `filesProcessed === 0` AND REPORTED CONVERGED OVER 210 OF 554 FILES.
  //
  // The collector enumerated only the first `maxFiles` of the repo, subtracted the ledger from
  // that truncated list, found nothing pending, and said so honestly — its list WAS exhausted.
  // "Nothing pending" was a fact about the list, and I read it as a fact about the repository.
  // Written to avoid being fooled by a ceiling, fooled by a ceiling one layer down.
  //
  // ⇒ Convergence now requires BOTH: nothing pending AND the collector affirming completeness
  // over a walk that was not truncated. Either alone is a description of the list.
  const nothingPending = (s.filesProcessed ?? 0) === 0 && (s.remaining ?? 0) === 0;
  const walkTruncated = Boolean(s.enumeration?.truncated);
  if (nothingPending && walkTruncated) {
    console.log('STOP: nothing pending, but the WALK was truncated — this is a floor, not coverage.');
    break;
  }
  if (nothingPending) { converged = true; break; }
  // ⚠ A batch that ran but added nothing is not progress. Without this the loop spins to the
  // ceiling and the ceiling gets reported as completion.
  if (now.records === lastRecords && (s.filesProcessed ?? 0) > 0) {
    console.log('STOP: a batch processed files but added no records — not converged, investigate.');
    break;
  }
  lastRecords = now.records;
}

const after = graphState();
console.log(`\nend    records=${after.records} collections=${after.collections} `
  + `lspEdges=${after.lspEdges} referenceNodes=${after.refNodes}`);
console.log(converged
  ? `CONVERGED after ${batches + 1} batch(es).`
  : `NOT CONVERGED — stopped after ${batches} batch(es). This is a floor on coverage, not a total.`);
process.exit(converged ? 0 : 1);
