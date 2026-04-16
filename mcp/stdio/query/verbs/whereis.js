import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const SEARCH_TYPES = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Variable', 'Test', 'Route', 'Entrypoint'];

export async function graphWhereis({ repoRoot, symbol, limit = 5 }) {
  await ensureFresh({ repoRoot });
  const graphDir = join(repoRoot, '.aify-graph');
  const db = openDb(join(graphDir, 'graph.sqlite'));
  try {
    const hits = db.all(
      `SELECT * FROM nodes WHERE label = $label AND type IN (${SEARCH_TYPES.map(t => `'${t}'`).join(',')}) LIMIT $limit`,
      { label: symbol, limit }
    );
    if (hits.length === 0) return 'NO MATCH';
    return renderCompact({ nodes: hits, edges: [] });
  } finally {
    db.close();
  }
}
