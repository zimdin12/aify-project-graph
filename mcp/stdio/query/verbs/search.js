import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

// Code-first ranking: agents want code symbols, not docs/dirs
const CODE_TYPES = new Set(['Function', 'Method', 'Class', 'Interface', 'Type', 'Test']);
const STRUCTURE_TYPES = new Set(['File', 'Module', 'Entrypoint', 'Route', 'Schema']);
// Document, Directory, Config are lowest priority

function scoreNode(node, query) {
  let score = 0;

  // Type priority: code > structure > docs
  if (CODE_TYPES.has(node.type)) score += 1000;
  else if (STRUCTURE_TYPES.has(node.type)) score += 500;
  else score += 100;

  // Exact match beats prefix beats substring
  const label = node.label.toLowerCase();
  const q = query.toLowerCase();
  if (label === q) score += 500;
  else if (label.startsWith(q)) score += 300;
  else if (label.includes(q)) score += 100;

  // Fan-in as tiebreaker (from confidence as proxy)
  score += (node.confidence ?? 0) * 10;

  return score;
}

export async function graphSearch({ repoRoot, query, type, file, kind = 'code', limit = 20 }) {
  if (!query || query.trim().length === 0) {
    return 'QUERY_TOO_SHORT — provide at least 1 character';
  }

  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const clauses = ['label LIKE $q'];
    const params = { q: `%${query}%`, limit: Math.min(limit, 100) };

    if (type) {
      clauses.push('type = $type');
      params.type = type;
    } else if (kind === 'code') {
      // Default: exclude docs/dirs/configs/external terminals unless explicitly requested.
      clauses.push("type NOT IN ('Document', 'Directory', 'Config', 'External')");
    }

    if (file) {
      clauses.push('file_path LIKE $file');
      params.file = `${file}%`;
    }

    const where = clauses.join(' AND ');
    // Fetch more than needed so we can re-rank in memory
    const hits = db.all(
      `SELECT * FROM nodes WHERE ${where} LIMIT 200`,
      params
    );

    if (hits.length === 0) {
      return `NO RESULTS for "${query}". Try graph_search(query="${query}", kind="all") to include docs/configs, or check graph_status() to verify the graph covers your files.`;
    }

    // Re-rank by agent-intent scoring
    const scored = hits
      .map(n => ({ ...n, _score: scoreNode(n, query) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);

    return renderCompact({ nodes: scored, edges: [] });
  } finally {
    db.close();
  }
}
