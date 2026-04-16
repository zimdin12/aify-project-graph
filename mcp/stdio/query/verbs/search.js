import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

export async function graphSearch({ repoRoot, query, type, file, limit = 20 }) {
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const clauses = ['label LIKE $q'];
    const params = { q: `%${query}%`, limit };

    if (type) {
      clauses.push('type = $type');
      params.type = type;
    }
    if (file) {
      clauses.push('file_path LIKE $file');
      params.file = `${file}%`;
    }

    const where = clauses.join(' AND ');
    const hits = db.all(
      `SELECT * FROM nodes WHERE ${where} ORDER BY confidence DESC, label LIMIT $limit`,
      params
    );

    if (hits.length === 0) return 'NO RESULTS';
    return renderCompact({ nodes: hits, edges: [] });
  } finally {
    db.close();
  }
}
