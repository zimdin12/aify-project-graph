import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderPath } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

export async function graphPath({ repoRoot, symbol, direction = 'out', depth = 5, top_k = 3 }) {
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const sources = db.all('SELECT * FROM nodes WHERE label = $label', { label: symbol });
    if (sources.length === 0) return 'NO MATCH';

    const root = sources[0];
    const paths = buildPaths(db, root, direction, depth, top_k, new Set());

    if (paths.length === 0) return 'NO PATHS';
    return renderPath(paths);
  } finally {
    db.close();
  }
}

function buildPaths(db, node, direction, maxDepth, topK, visited) {
  const nodeId = node.node_id ?? node.id;
  if (maxDepth <= 0 || visited.has(nodeId)) return [];
  visited.add(nodeId);

  const result = {
    symbol: node.label,
    file: node.file_path,
    line: node.start_line,
    confidence: node.confidence ?? node.node_confidence ?? 1.0,
    children: [],
  };

  // Get next-hop edges
  const edges = direction === 'out'
    ? db.all(
        `SELECT n.id AS node_id, n.label, n.file_path, n.start_line, n.confidence AS node_confidence, e.confidence AS edge_confidence
         FROM edges e JOIN nodes n ON n.id = e.to_id
         WHERE e.from_id = $id AND e.relation IN ('CALLS', 'INVOKES', 'REFERENCES')
         ORDER BY e.confidence DESC LIMIT $limit`,
        { id: nodeId, limit: topK }
      )
    : db.all(
        `SELECT n.id AS node_id, n.label, n.file_path, n.start_line, n.confidence AS node_confidence, e.confidence AS edge_confidence
         FROM edges e JOIN nodes n ON n.id = e.from_id
         WHERE e.to_id = $id AND e.relation IN ('CALLS', 'INVOKES', 'REFERENCES')
         ORDER BY e.confidence DESC LIMIT $limit`,
        { id: nodeId, limit: topK }
      );

  for (const edge of edges) {
    const child = buildPaths(db, edge, direction, maxDepth - 1, topK, visited);
    if (child.length > 0) {
      result.children.push(...child);
    } else {
      result.children.push({
        symbol: edge.label,
        file: edge.file_path,
        line: edge.start_line,
        confidence: edge.node_confidence ?? 0.9,
        children: [],
      });
    }
  }

  return [result];
}
