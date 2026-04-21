import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

// Code-first ranking: agents want code symbols, not docs/dirs
const CODE_TYPES = new Set(['Function', 'Method', 'Class', 'Interface', 'Type', 'Test']);
const STRUCTURE_TYPES = new Set(['File', 'Module', 'Entrypoint', 'Route', 'Schema']);
// Document, Directory, Config are lowest priority
const EXACT_SYMBOL_RE = /^[A-Za-z_][A-Za-z0-9_.$:-]*$/;

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

function buildSearchFilters({ type, file, kind }) {
  const clauses = [];
  const params = {};

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

  return { clauses, params };
}

export async function graphSearch({ repoRoot, query, type, file, kind = 'code', limit = 20 }) {
  if (!query || query.trim().length === 0) {
    return 'QUERY_TOO_SHORT — provide at least 1 character';
  }

  const normalizedQuery = query.trim();
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const cappedLimit = Math.min(limit, 100);
    const { clauses: baseClauses, params: baseParams } = buildSearchFilters({ type, file, kind });

    // Fast path: exact symbol-style queries should not pay the broad substring scan
    // when we already have a direct hit.
    if (EXACT_SYMBOL_RE.test(normalizedQuery)) {
      const exactClauses = ['label = $label', ...baseClauses];
      const exactHits = db.all(
        `SELECT * FROM nodes WHERE ${exactClauses.join(' AND ')} LIMIT $limit`,
        { ...baseParams, label: normalizedQuery, limit: cappedLimit }
      );
      if (exactHits.length > 0) {
        return renderCompact({ nodes: exactHits, edges: [] });
      }
    }

    const clauses = ['label LIKE $q', ...baseClauses];
    const params = { ...baseParams, q: `%${normalizedQuery}%`, limit: cappedLimit };
    const where = clauses.join(' AND ');
    // Fetch more than needed so we can re-rank in memory
    const hits = db.all(
      `SELECT * FROM nodes WHERE ${where} LIMIT 200`,
      params
    );

    if (hits.length === 0) {
      return `NO RESULTS for "${normalizedQuery}". Try graph_search(query="${normalizedQuery}", kind="all") to include docs/configs, or check graph_status() to verify the graph covers your files.`;
    }

    // Re-rank by agent-intent scoring
    const scored = hits
      .map(n => ({ ...n, _score: scoreNode(n, normalizedQuery) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);

    return renderCompact({ nodes: scored, edges: [] });
  } finally {
    db.close();
  }
}
