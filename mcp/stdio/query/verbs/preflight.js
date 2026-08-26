import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { selectBestRoot } from './path.js';
import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import { buildTrustLine, provenanceRankSql } from '../lsp-evidence.js';
import { renderProvenanceTag } from '../renderer.js';
import { computeCompileDbCoverage } from '../../code-intel/compile-db.js';
import { missScopeNote } from '../miss-scope.js';

// The declaration types preflight resolves over. Named so the miss message can state the
// population it actually searched instead of implying the repository.
const PREFLIGHT_TYPES = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Test'];

/**
 * One-shot edit safety check. Combines whereis + callers + impact + tests + trust
 * into a single verb with a SAFE/REVIEW/CONFIRM decision recommendation.
 */
export async function graphPreflight({ repoRoot, symbol }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_preflight' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    // 1. Find the symbol
    // The population was written as a SQL string literal, so the miss message could not name
    // what it had searched even in principle. One array, used for both.
    const nodes = resolveSymbol(db, symbol, PREFLIGHT_TYPES.map((t) => `'${t}'`).join(','));
    if (nodes.length === 0) {
      const base = `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;
      const scope = missScopeNote(db, { types: PREFLIGHT_TYPES, what: 'declaration types' });
      return scope ? `${base}\n${scope}` : base;
    }
    const ambiguity = buildAmbiguousMatchMessage(symbol, nodes);
    if (ambiguity) return ambiguity;
    const node = selectBestRoot(nodes);

    // 2. Count callers
    const callerCount = db.get(
      "SELECT count(*) AS c FROM edges WHERE to_id = $id AND relation IN ('CALLS','REFERENCES','INVOKES','PASSES_THROUGH')",
      { id: node.id }
    ).c;

    // 3. Top 5 callers with labels.
    //
    // ⛔ TIER FIRST, CONFIDENCE SECOND. Ordering by confidence alone showed five EXTRACTED callers,
    // all from test files, for the symbol Context — while 124 LSP_VERIFIED callers existed on that
    // same symbol in that same graph. Every candidate ties at conf=0.95, so the tie-break was
    // arbitrary and the compiler-verified evidence simply lost it. On the verb that answers "is this
    // safe to change", the strongest evidence available has to be the evidence shown.
    const topCallers = db.all(
      `SELECT n.label, n.file_path, e.source_line, e.relation, e.confidence, e.provenance
       FROM edges e JOIN nodes n ON n.id = e.from_id
       WHERE e.to_id = $id AND e.relation IN ('CALLS','REFERENCES','INVOKES','PASSES_THROUGH')
       ORDER BY ${provenanceRankSql('e.provenance')} DESC, e.confidence DESC LIMIT 5`,
      { id: node.id }
    );

    // HEADLINE trust evidence — all incoming caller edges' provenance, so the
    // lsp axis below reflects the full caller set, not just the top 5 shown.
    const incomingProvenance = db.all(
      `SELECT e.provenance FROM edges e
       WHERE e.to_id = $id AND e.relation IN ('CALLS','REFERENCES','INVOKES','PASSES_THROUGH')`,
      { id: node.id }
    );

    // 4. Impact count by type
    const impactByType = db.all(
      `SELECT relation, count(*) AS c FROM edges
       WHERE to_id = $id AND relation IN ('CALLS','REFERENCES','USES_TYPE','TESTS')
       GROUP BY relation`,
      { id: node.id }
    );

    // 5. Test coverage
    const tests = db.all(
      `SELECT n.label, n.file_path FROM edges e
       JOIN nodes n ON n.id = e.from_id
       WHERE e.to_id = $id AND e.relation = 'TESTS' LIMIT 5`,
      { id: node.id }
    );

    // 6. Trust: count unresolved edges in the same file
    const manifest = await import('../../freshness/manifest.js')
      .then(m => m.loadManifest(join(repoRoot, '.aify-graph')));
    const { trust: dirtyCount } = getUnresolvedCounts(manifest.manifest);

    // 7. Cross-module check
    const callerFiles = new Set(topCallers.map(c => c.file_path).filter(Boolean));
    const crossModule = callerFiles.size > 1 && !([...callerFiles].every(f => f.startsWith(node.file_path.split('/').slice(0, -1).join('/') + '/')));

    // 8. Compute decision. The caller set is "lsp-verified" only when at least
    // one incoming caller edge is clangd ground truth (LSP_VERIFIED) — that is
    // the only basis on which a low/empty caller set may read as SAFE-to-proceed.
    const callersHaveLspEvidence = incomingProvenance.some((row) => row.provenance === 'LSP_VERIFIED');
    let coverageComplete = true;
    let coverageReason = '';
    try {
      // Only a FOREIGN/UNITY DB downgrades a pre-collected lsp-verified caller
      // set; a DB absent at query time must not flip SAFE→REVIEW (the edges were
      // ground truth at collection time).
      const cov = computeCompileDbCoverage({ projectRoot: repoRoot });
      if (cov && cov.complete === false && (cov.foreignToolchain || cov.unityUnexpanded)) {
        coverageComplete = false; coverageReason = cov.reason || '';
      }
    } catch { /* defensive — treat as complete */ }
    const decision = computeDecision({
      callerCount,
      testCount: tests.length,
      dirtyCount,
      crossModule,
      confidence: node.confidence ?? 1.0,
      callersHaveLspEvidence,
      coverageComplete,
      coverageReason,
    });

    // HEADLINE trust line — lsp-verified/lsp-partial/heuristic axis (cohesion
    // fix R2/C2), the SAME vocabulary as graph_callers / server-instructions /
    // the lean default. Derived from the provenance of the incoming caller edges.
    let headlineTrust = '';
    try {
      const trustEdges = incomingProvenance.map((row) => ({ provenance: row.provenance ?? 'EXTRACTED' }));
      headlineTrust = await buildTrustLine({ edges: trustEdges, db, repoRoot });
    } catch { /* defensive — never block the preflight on trust-line failure */ }

    // Build output
    const lines = [];
    lines.push(`PREFLIGHT ${node.label} ${(node.type ?? 'unknown').toLowerCase()} ${node.file_path}:${node.start_line}`);
    if (headlineTrust) lines.push(headlineTrust);
    lines.push('');

    // Callers
    lines.push(`CALLERS ${callerCount} total${topCallers.length > 0 ? ' (top 5):' : ''}`);
    for (const c of topCallers) {
      // ⛔ THE ROW ALREADY CARRIED `provenance` AND THE RENDERER THREW IT AWAY. Selected on line 46,
      // dropped here — so a heuristic caller and a compiler-verified one printed as the same string.
      // Eight verbs route through the shared tag; this one hand-rolled its line and lost it.
      lines.push(`  ${c.label} ${c.relation} ${c.file_path}:${c.source_line} conf=${Number(c.confidence ?? 1).toFixed(2)}${renderProvenanceTag(c.provenance)}`);
    }
    lines.push('');

    // Impact
    const impactStr = impactByType.map(r => `${r.c} ${r.relation}`).join(', ') || 'none';
    lines.push(`IMPACT ${impactStr}`);
    if (crossModule) lines.push('  CROSS-MODULE: callers span multiple directories');
    lines.push('');

    // Tests
    if (tests.length > 0) {
      lines.push(`TESTS ${tests.length} covering this symbol:`);
      for (const t of tests) lines.push(`  ${t.label} ${t.file_path}`);
    } else {
      lines.push('TESTS NONE');
    }
    lines.push('');

    // Graph completeness — SECONDARY qualifier on the edge-count axis. The
    // HEADLINE trust line (lsp axis) is emitted up top; this stays as a
    // graph-completeness signal so the agent still sees unresolved-edge load.
    if (dirtyCount > 100) {
      lines.push(`GRAPH COMPLETENESS WEAK — ${dirtyCount} unresolved edges (graph may be incomplete)`);
    } else if (dirtyCount > 0) {
      lines.push(`GRAPH COMPLETENESS OK — ${dirtyCount} unresolved edges`);
    } else {
      lines.push('GRAPH COMPLETENESS STRONG — 0 unresolved edges');
    }
    lines.push('');

    // Decision
    lines.push(`DECISION: ${decision.tier}`);
    lines.push(`  ${decision.reason}`);

    return prefixReadWarnings(lines.join('\n'), freshness.warnings);
  } finally {
    db.close();
  }
}

export function computeDecision({ callerCount, testCount, dirtyCount, crossModule, confidence, callersHaveLspEvidence = false, coverageComplete = true, coverageReason = '' }) {
  // CONFIRM: many callers + cross-module OR weak trust
  if (callerCount > 5 && crossModule) {
    return { tier: 'CONFIRM', reason: `${callerCount} callers across module boundaries — confirm change scope with user before editing.` };
  }
  if (callerCount > 10) {
    return { tier: 'CONFIRM', reason: `${callerCount} callers — high fan-in. Confirm scope with user.` };
  }
  if (dirtyCount > 100 && callerCount > 3) {
    return { tier: 'CONFIRM', reason: `Trust is weak (${dirtyCount} unresolved) and ${callerCount} callers — verify with file reads before editing.` };
  }

  // REVIEW: moderate callers or no tests
  if (callerCount > 1 && testCount === 0) {
    return { tier: 'REVIEW', reason: `${callerCount} callers but no test coverage — read each caller file before editing.` };
  }
  if (callerCount > 1) {
    return { tier: 'REVIEW', reason: `${callerCount} callers — read affected files before editing.` };
  }

  // R2-2026-05-31 (BUG 2) — honest absence gate. A low/empty caller set is only
  // SAFE-to-proceed when it is backed by live per-symbol clangd evidence
  // (LSP_VERIFIED incoming edges). The heuristic graph's caller set is NOT
  // exhaustive (cross-TU dispatch is undercounted), so an empty/heuristic-only
  // caller set must NEVER read as "SAFE — proceed / safe to delete". Downgrade
  // to REVIEW and point at code_intel_references for a trustworthy check.
  if (!callersHaveLspEvidence) {
    return {
      tier: 'REVIEW',
      reason: `${callerCount} caller(s) — caller set is heuristic, not exhaustive; verify with code_intel_references before deleting/changing signature.`,
    };
  }

  // FALSE-EXHAUSTIVE GUARD (2026-06-02): LSP_VERIFIED edges are present, but on a
  // foreign (Linux/WSL) or unexpanded-unity compile DB the clangd index is
  // silently PARTIAL — real cross-TU callers live in TUs that never compiled. An
  // lsp-verified caller set is then a FLOOR, so it must NOT read as SAFE-to-
  // delete. Downgrade to REVIEW with the foreign/unity remedy. (Same root cause
  // the coverage gate fixed in code_intel_references / hierarchy.)
  if (coverageComplete === false) {
    const remedy = /unity/i.test(coverageReason) ? 'expand the unity build' : 'set APG_CLANGD_WSL=1';
    return {
      tier: 'REVIEW',
      reason: `${callerCount} lsp-verified caller(s), but the compile DB only PARTIALLY covers this repo (${remedy}) — the caller set is a floor; verify with code_intel_references / rg before deleting/changing signature.`,
    };
  }

  // SAFE: 0-1 callers with tests, backed by live clangd per-symbol evidence
  if (testCount > 0) {
    return { tier: 'SAFE', reason: `${callerCount} caller(s) with ${testCount} test(s) covering it (lsp-verified) — proceed.` };
  }
  return { tier: 'SAFE', reason: `${callerCount} caller(s) (lsp-verified) — low risk, proceed.` };
}
