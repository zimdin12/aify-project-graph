import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { enforceBudget } from '../budget.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { selectBestRoot } from './path.js';
import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';

const ALL_RELATIONS = [
  'CONTAINS', 'DEFINES', 'DECLARES', 'IMPORTS', 'EXPORTS',
  'CALLS', 'REFERENCES', 'EXTENDS', 'IMPLEMENTS', 'USES_TYPE',
  'TESTS', 'DEPENDS_ON', 'MENTIONS', 'INVOKES', 'PASSES_THROUGH', 'CONFIGURES',
];

export async function graphNeighbors({ repoRoot, symbol, edge_types = [], depth = 1, top_k = 20 }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const targets = resolveSymbol(db, symbol);
    if (targets.length === 0) return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;
    const ambiguity = buildAmbiguousMatchMessage(symbol, targets);
    if (ambiguity) return ambiguity;

    const types = edge_types.length ? edge_types : ALL_RELATIONS;
    const safeTypes = types.filter(t => ALL_RELATIONS.includes(t));
    if (safeTypes.length === 0) return `NO MATCH — none of the requested edge_types are valid. Valid types: ${ALL_RELATIONS.join(', ')}.`;
    const relFilter = safeTypes.map(t => `'${t}'`).join(',');
    const nodeId = selectBestRoot(targets).id;

    const edges = db.all(
      `SELECT e.*, n.label AS neighbor_label, n.file_path AS neighbor_file, n.start_line AS neighbor_line
       FROM edges e JOIN nodes n ON (n.id = e.to_id OR n.id = e.from_id)
       WHERE (e.from_id = $id OR e.to_id = $id) AND e.relation IN (${relFilter})
       AND n.id != $id
       LIMIT 100`,
      { id: nodeId }
    );

    if (edges.length === 0) return `NO NEIGHBORS for "${symbol}". The symbol may be isolated. Try graph_whereis(symbol="${symbol}") to confirm it exists, or graph_search(query="${symbol}") for similar names.`;

    const mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      source_file: e.source_file, source_line: e.source_line,
      confidence: e.confidence,
      provenance: e.provenance ?? 'EXTRACTED',
      depth: 1, from_type: 'Function', fan_in: 1,
    }));
    const { kept, dropped } = enforceBudget(mapped, top_k);
    return renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `top_k=${top_k + 20}` });
  } finally {
    db.close();
  }
}
