import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { enforceBudget } from '../budget.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { expandClassRollupTargets } from './target_rollup.js';

const IMPACT_RELATIONS = ['CALLS', 'REFERENCES', 'USES_TYPE', 'TESTS'];

export async function graphImpact({ repoRoot, symbol, depth = 3, top_k = 30 }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const { targets, targetIds, rolledUp, header } = expandClassRollupTargets(db, symbol);
    if (targets.length === 0) return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;

    const relFilter = IMPACT_RELATIONS.map(r => `'${r}'`).join(',');
    const placeholders = targetIds.map((_, index) => `$tid${index}`).join(', ');
    const params = Object.fromEntries(targetIds.map((id, index) => [`tid${index}`, id]));

    const edges = db.all(
      `WITH RECURSIVE impact(node_id, depth) AS (
         SELECT from_id, 1 FROM edges WHERE to_id IN (${placeholders}) AND relation IN (${relFilter})
         UNION ALL
         SELECT e.from_id, i.depth + 1 FROM edges e JOIN impact i ON e.to_id = i.node_id
         WHERE e.relation IN (${relFilter}) AND i.depth < $depth AND i.depth <= 10
       )
       SELECT DISTINCT e.*, n.label AS from_label, n.type AS from_type,
              n.file_path AS from_file, n.start_line AS from_line, i.depth
       FROM impact i JOIN edges e ON e.from_id = i.node_id
       JOIN nodes n ON n.id = e.from_id
       WHERE e.relation IN (${relFilter})
       LIMIT 100`,
      { ...params, depth }
    );

    if (edges.length === 0) return `NO IMPACT — no edges found for "${symbol}". The symbol may have 0 callers, or the graph may be incomplete. Check graph_status().`;

    const mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      source_file: e.from_file, source_line: e.from_line,
      confidence: e.confidence, depth: e.depth ?? 1,
      from_type: e.from_type, fan_in: 1,
    }));
    const { kept, dropped } = enforceBudget(mapped, top_k);
    const body = renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `depth=${depth + 1}` });
    return rolledUp ? `${header}\n${body}` : body;
  } finally {
    db.close();
  }
}
