import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { enforceBudget } from '../budget.js';
import { expandClassRollupTargets } from './target_rollup.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';

const IMPACT_RELATIONS = ['CALLS', 'REFERENCES', 'USES_TYPE', 'TESTS', 'INVOKES', 'PASSES_THROUGH'];

export async function graphImpact({ repoRoot, symbol, depth = 3, top_k = 30 }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_impact' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const { targets, targetIds, rolledUp, header, error } = expandClassRollupTargets(db, symbol);
    if (error) return error;
    if (targets.length === 0) return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;

    const relFilter = IMPACT_RELATIONS.map(r => `'${r}'`).join(',');
    const placeholders = targetIds.map((_, index) => `$tid${index}`).join(', ');
    const params = Object.fromEntries(targetIds.map((id, index) => [`tid${index}`, id]));

    const edges = db.all(
      `WITH RECURSIVE impact(from_id, to_id, depth) AS (
         SELECT from_id, to_id, 1
         FROM edges
         WHERE to_id IN (${placeholders}) AND relation IN (${relFilter})
         UNION ALL
         SELECT e.from_id, e.to_id, i.depth + 1
         FROM edges e
         JOIN impact i ON e.to_id = i.from_id
         WHERE e.relation IN (${relFilter}) AND i.depth < $depth AND i.depth <= 10
       )
       SELECT DISTINCT e.*, n.label AS from_label, n.type AS from_type,
              n.file_path AS from_file, n.start_line AS from_line,
              t.label AS to_label, i.depth
       FROM impact i
       JOIN edges e
         ON e.from_id = i.from_id
        AND e.to_id = i.to_id
        AND e.relation IN (${relFilter})
       JOIN nodes n ON n.id = e.from_id
       LEFT JOIN nodes t ON t.id = e.to_id
       LIMIT 100`,
      { ...params, depth }
    );

    if (edges.length === 0) return `NO IMPACT — no edges found for "${symbol}". The symbol may have 0 callers, or the graph may be incomplete. Check graph_status().`;

    const mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      source_file: e.from_file, source_line: e.from_line,
      confidence: e.confidence,
      provenance: e.provenance ?? 'EXTRACTED',
      depth: e.depth ?? 1,
      from_type: e.from_type, from_label: e.from_label,
      to_label: e.to_label, fan_in: 1,
    }));
    const { kept, dropped } = enforceBudget(mapped, top_k);
    const body = renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `depth=${depth + 1}` });
    return prefixReadWarnings(rolledUp ? `${header}\n${body}` : body, freshness.warnings);
  } finally {
    db.close();
  }
}
