import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

/**
 * One-shot edit safety check. Combines whereis + callers + impact + tests + trust
 * into a single verb with a SAFE/REVIEW/CONFIRM decision recommendation.
 */
export async function graphPreflight({ repoRoot, symbol }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    // 1. Find the symbol
    const nodes = db.all(
      "SELECT * FROM nodes WHERE label = $label AND type IN ('Function','Method','Class','Interface','Type','Test') LIMIT 5",
      { label: symbol }
    );
    if (nodes.length === 0) return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;
    const node = nodes[0];

    // 2. Count callers
    const callerCount = db.get(
      "SELECT count(*) AS c FROM edges WHERE to_id = $id AND relation IN ('CALLS','REFERENCES','INVOKES','PASSES_THROUGH')",
      { id: node.id }
    ).c;

    // 3. Top 5 callers with labels
    const topCallers = db.all(
      `SELECT n.label, n.file_path, e.source_line, e.relation, e.confidence
       FROM edges e JOIN nodes n ON n.id = e.from_id
       WHERE e.to_id = $id AND e.relation IN ('CALLS','REFERENCES','INVOKES','PASSES_THROUGH')
       ORDER BY e.confidence DESC LIMIT 5`,
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
    const dirtyCount = manifest.manifest?.dirtyEdgeCount ?? (manifest.manifest?.dirtyEdges ?? []).length;

    // 7. Cross-module check
    const callerFiles = new Set(topCallers.map(c => c.file_path).filter(Boolean));
    const crossModule = callerFiles.size > 1 && !([...callerFiles].every(f => f.startsWith(node.file_path.split('/').slice(0, -1).join('/') + '/')));

    // 8. Compute decision
    const decision = computeDecision({
      callerCount,
      testCount: tests.length,
      dirtyCount,
      crossModule,
      confidence: node.confidence ?? 1.0,
    });

    // Build output
    const lines = [];
    lines.push(`PREFLIGHT ${node.label} ${(node.type ?? 'unknown').toLowerCase()} ${node.file_path}:${node.start_line}`);
    lines.push('');

    // Callers
    lines.push(`CALLERS ${callerCount} total${topCallers.length > 0 ? ' (top 5):' : ''}`);
    for (const c of topCallers) {
      lines.push(`  ${c.label} ${c.relation} ${c.file_path}:${c.source_line} conf=${Number(c.confidence ?? 1).toFixed(2)}`);
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

    // Trust
    if (dirtyCount > 100) {
      lines.push(`TRUST WEAK — ${dirtyCount} unresolved edges (graph may be incomplete)`);
    } else if (dirtyCount > 0) {
      lines.push(`TRUST OK — ${dirtyCount} unresolved edges`);
    } else {
      lines.push('TRUST STRONG — 0 unresolved edges');
    }
    lines.push('');

    // Decision
    lines.push(`DECISION: ${decision.tier}`);
    lines.push(`  ${decision.reason}`);

    return lines.join('\n');
  } finally {
    db.close();
  }
}

export function computeDecision({ callerCount, testCount, dirtyCount, crossModule, confidence }) {
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

  // SAFE: 0-1 callers with tests
  if (testCount > 0) {
    return { tier: 'SAFE', reason: `${callerCount} caller(s) with ${testCount} test(s) covering it — proceed.` };
  }
  return { tier: 'SAFE', reason: `${callerCount} caller(s) — low risk, proceed.` };
}
