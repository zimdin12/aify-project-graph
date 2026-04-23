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

    // Get directories and files under the path
    const nodes = db.all(
      `SELECT * FROM nodes
       WHERE (type IN ('Directory', 'File') AND file_path LIKE $pattern)
       ORDER BY file_path
       LIMIT $limit`,
      { pattern: prefix ? `${prefix}%` : '%', limit: top_k }
    );

    // Get symbols defined in files under the path (depth 2 = show symbols inside files)
    let symbolNodes = [];
    if (depth >= 2) {
      symbolNodes = db.all(
        `SELECT n.* FROM nodes n
         JOIN edges e ON e.to_id = n.id
         WHERE e.relation IN ('DEFINES', 'CONTAINS')
         AND e.source_file LIKE $pattern
         AND n.type NOT IN ('Directory', 'File', 'Document', 'Config')
         LIMIT $limit`,
        { pattern: prefix ? `${prefix}%` : '%', limit: top_k }
      );
    }

    const allNodes = [...nodes, ...symbolNodes];
    if (allNodes.length === 0) return 'NO NODES AT PATH';

    return prefixReadWarnings(renderCompact({ nodes: allNodes, edges: [], truncated: 0 }), freshness.warnings);
  } finally {
    db.close();
  }
}
