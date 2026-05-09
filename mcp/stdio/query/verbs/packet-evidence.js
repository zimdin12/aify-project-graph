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
  let block = { available: false, reason: 'no_collection' };
  try {
    const db = openExistingDb(dbPath);
    try {
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
    } finally { db.close(); }
  } catch { /* leave block as not-available */ }
  return block;
}

export function renderEvidenceBlock(block) {
  if (!block || !block.available) {
    return renderEvidenceLine({ available: false, reason: block?.reason || 'no_collection' });
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
