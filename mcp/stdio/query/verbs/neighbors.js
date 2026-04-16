import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { enforceBudget } from '../budget.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const ALL_RELATIONS = [
  'CONTAINS', 'DEFINES', 'DECLARES', 'IMPORTS', 'EXPORTS',
  'CALLS', 'REFERENCES', 'EXTENDS', 'IMPLEMENTS', 'USES_TYPE',
  'TESTS', 'DEPENDS_ON', 'MENTIONS', 'INVOKES', 'CONFIGURES',
];

export async function graphNeighbors({ repoRoot, symbol, edge_types = [], depth = 1, top_k = 20 }) {
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const targets = db.all('SELECT id FROM nodes WHERE label = $label', { label: symbol });
    if (targets.length === 0) return 'NO MATCH';

    const types = edge_types.length ? edge_types : ALL_RELATIONS;
    const safeTypes = types.filter(t => ALL_RELATIONS.includes(t));
    if (safeTypes.length === 0) return 'NO MATCH';
    const relFilter = safeTypes.map(t => `'${t}'`).join(',');
    const nodeId = targets[0].id;

    const edges = db.all(
      `SELECT e.*, n.label AS neighbor_label, n.file_path AS neighbor_file, n.start_line AS neighbor_line
       FROM edges e JOIN nodes n ON (n.id = e.to_id OR n.id = e.from_id)
       WHERE (e.from_id = $id OR e.to_id = $id) AND e.relation IN (${relFilter})
       AND n.id != $id
       LIMIT 100`,
      { id: nodeId }
    );

    if (edges.length === 0) return 'NO NEIGHBORS';

    const mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      source_file: e.source_file, source_line: e.source_line,
      confidence: e.confidence, depth: 1, from_type: 'Function', fan_in: 1,
    }));
    const { kept, dropped } = enforceBudget(mapped, top_k);
    return renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `top_k=${top_k + 20}` });
  } finally {
    db.close();
  }
}
