import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';

export async function graphModuleTree({ repoRoot, path = '.', depth = 2, top_k = 30 }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_module_tree' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const prefix = path === '.' ? '' : path;
    const broadRoot = prefix === '';
    const treeLimit = broadRoot ? Math.min(top_k, 2) : top_k;
    const symbolLimit = broadRoot ? Math.min(top_k, 2) : top_k;

    // Get directories and files under the path
    const nodes = db.all(
      `SELECT * FROM nodes
       WHERE (type IN ('Directory', 'File') AND file_path LIKE $pattern)
       ORDER BY file_path
       LIMIT $limit`,
      { pattern: prefix ? `${prefix}%` : '%', limit: treeLimit }
    );
    const totalTreeNodes = db.get(
      `SELECT count(*) AS c FROM nodes
       WHERE (type IN ('Directory', 'File') AND file_path LIKE $pattern)`,
      { pattern: prefix ? `${prefix}%` : '%' }
    ).c;

    // Get symbols defined in files under the path (depth 2 = show symbols inside files)
    let symbolNodes = [];
    let totalSymbolNodes = 0;
    if (depth >= 2) {
      symbolNodes = db.all(
        `SELECT n.* FROM nodes n
         JOIN edges e ON e.to_id = n.id
         WHERE e.relation IN ('DEFINES', 'CONTAINS')
         AND e.source_file LIKE $pattern
         AND n.type NOT IN ('Directory', 'File', 'Document', 'Config')
         LIMIT $limit`,
        { pattern: prefix ? `${prefix}%` : '%', limit: symbolLimit }
      );
      totalSymbolNodes = db.get(
        `SELECT count(*) AS c
         FROM nodes n
         JOIN edges e ON e.to_id = n.id
         WHERE e.relation IN ('DEFINES', 'CONTAINS')
         AND e.source_file LIKE $pattern
         AND n.type NOT IN ('Directory', 'File', 'Document', 'Config')`,
        { pattern: prefix ? `${prefix}%` : '%' }
      ).c;
    }

    const allNodes = [...nodes, ...symbolNodes];
    if (allNodes.length === 0) return 'NO NODES AT PATH';
    const lines = [renderCompact({ nodes: allNodes, edges: [], truncated: 0 })];
    const extraTreeNodes = Math.max(0, totalTreeNodes - nodes.length);
    const extraSymbolNodes = Math.max(0, totalSymbolNodes - symbolNodes.length);
    if (extraTreeNodes > 0) {
      lines.push(`TRUNCATED ${extraTreeNodes} more tree node(s)${broadRoot ? " (use path='src' or raise top_k)" : ` (use top_k=${top_k + extraTreeNodes})`}`);
    }
    if (extraSymbolNodes > 0) {
      lines.push(`TRUNCATED ${extraSymbolNodes} more symbol node(s)${broadRoot ? " (narrow path or raise top_k)" : ` (use top_k=${top_k + extraSymbolNodes})`}`);
    }

    return prefixReadWarnings(lines.filter(Boolean).join('\n'), freshness.warnings);
  } finally {
    db.close();
  }
}
