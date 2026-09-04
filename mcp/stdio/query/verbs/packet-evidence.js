import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { openExistingDb } from '../../storage/db.js';
import { getLatestCollection, getCodeIntelEvidenceForSymbol, getCodeIntelDiagnosticsForFiles } from '../../code-intel/query.js';
import { renderEvidenceLine, formatProvenanceTag, formatThreeStateRefs } from '../../code-intel/render.js';

export function buildEvidenceBlock({ repoRoot, symbol = null, files = [] } = {}) {
  const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
  if (!existsSync(dbPath)) {
    return { available: false, reason: 'no_graph' };
  }
  // THREE DIFFERENT FAULTS USED TO ARRIVE AS ONE CAUSE. `no_collection` is a claim about the
  // REPOSITORY, and it is only true when the collection question was actually ASKED and answered
  // "none". A database that will not open never got that far, and saying `no_collection` there
  // reports our own failure as the repo's state. See evidence-unavailable.js.
  let block = { available: false, reason: 'no_collection' };
  let db;
  try {
    db = openExistingDb(dbPath);
    // ⛔ ASK THE READABILITY QUESTION, DO NOT INFER IT FROM WHERE THE THROW LANDED. SQLite opens
    // lazily: a file of non-database bytes passes `openExistingDb` and only throws on the first
    // real query. Assigning the cause by which try block caught it would report an unreadable file
    // as a probe fault — the same position-not-fault mistake this module exists to remove, and a
    // test caught me making it here.
    db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
  } catch {
    try { db?.close(); } catch { /* the handle may never have opened */ }
    return { available: false, reason: 'graph_unreadable' };
  }
  try {
    {
      const latest = getLatestCollection(db);
      if (!latest) return block;
      const symbolEvidence = symbol ? getCodeIntelEvidenceForSymbol(db, { qname: String(symbol) }) : null;
      const diagnostics = files.length > 0 ? getCodeIntelDiagnosticsForFiles(db, files) : [];
      block = {
        available: true,
        provider: latest.provider,
        providerVersion: latest.providerVersion,
        status: latest.status,
        operations: latest.operations,
        freshnessBasis: latest.freshnessBasis,
        freshnessValue: latest.freshnessValue,
        compileDbHash: latest.compileDbHash,
        collectedAt: latest.collectedAt,
        symbol: symbolEvidence,
        diagnostics
      };
    }
  } catch {
    // The graph DID open, so this is not a fact about the repo either — it is a fault in the probe.
    return { available: false, reason: 'evidence_probe_failed' };
  } finally { db.close(); }
  return block;
}

export function renderEvidenceBlock(block) {
  if (!block || !block.available) {
    // A missing block means we were never told why. That is not `no_collection`, which is a
    // claim about the repo that nothing here established.
    return renderEvidenceLine({ available: false, reason: block?.reason || 'evidence_probe_failed' });
  }
  const lines = [renderEvidenceLine({
    available: true,
    provider: block.provider,
    providerVersion: block.providerVersion,
    status: block.status,
    operations: block.operations
  })];
  if (block.symbol && block.symbol.found) {
    const tag = formatProvenanceTag({ kind: 'reference', confidence: 'high', provenance: `${block.provider}@${block.providerVersion}` });
    lines.push(`  symbol: defs=${block.symbol.summary.definitions} refs=${block.symbol.summary.references} hovers=${block.symbol.summary.hovers} (${tag})`);
    if (block.symbol.references.length > 0) {
      const state = block.symbol.references[0]?.result_state || 'found';
      lines.push(`  ref state: ${formatThreeStateRefs({ state, count: block.symbol.references.length, providerStatus: block.status })}`);
    }
  }
  if (block.diagnostics?.length > 0) {
    const sevCounts = block.diagnostics.reduce((acc, d) => {
      const sev = d.raw?.severity || 'info';
      acc[sev] = (acc[sev] || 0) + 1;
      return acc;
    }, {});
    lines.push(`  diagnostics: ${Object.entries(sevCounts).map(([s, c]) => `${s}=${c}`).join(' ')}`);
  }
  return lines.join('\n');
}
