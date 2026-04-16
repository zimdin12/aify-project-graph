import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderPath } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

export async function graphPath({ repoRoot, from, direction = 'out', depth = 5, top_k = 3 }) {
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const sources = db.all('SELECT * FROM nodes WHERE label = $label', { label: from });
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
  if (maxDepth <= 0 || visited.has(node.id)) return [];
  visited.add(node.id);

  const result = {
    symbol: node.label,
    file: node.file_path,
    line: node.start_line,
    confidence: node.confidence ?? 1.0,
    children: [],
  };

  // Get next-hop edges
  const edges = direction === 'out'
    ? db.all(
        `SELECT e.*, n.* FROM edges e JOIN nodes n ON n.id = e.to_id
         WHERE e.from_id = $id AND e.relation = 'CALLS'
         ORDER BY e.confidence DESC LIMIT $limit`,
        { id: node.id, limit: topK }
      )
    : db.all(
        `SELECT e.*, n.* FROM edges e JOIN nodes n ON n.id = e.from_id
         WHERE e.to_id = $id AND e.relation = 'CALLS'
         ORDER BY e.confidence DESC LIMIT $limit`,
        { id: node.id, limit: topK }
      );

  for (const edge of edges) {
    const child = buildPaths(db, edge, direction, maxDepth - 1, topK, new Set(visited));
    if (child.length > 0) {
      result.children.push(...child);
    } else {
      result.children.push({
        symbol: edge.label,
        file: edge.file_path,
        line: edge.start_line,
        confidence: edge.confidence ?? 0.9,
        children: [],
      });
    }
  }

  return [result];
}
