import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const SEARCH_TYPES = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Variable', 'Test', 'Route', 'Entrypoint'];

export async function graphWhereis({ repoRoot, symbol, limit = 5, expand = false }) {
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const hits = db.all(
      `SELECT * FROM nodes WHERE label = $label AND type IN (${SEARCH_TYPES.map(t => `'${t}'`).join(',')}) LIMIT $limit`,
      { label: symbol, limit }
    );
    if (hits.length === 0) return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") for partial matches.`;

    if (!expand) {
      return renderCompact({ nodes: hits, edges: [] });
    }

    // Expand mode: include top 3 incoming + 3 outgoing edges (replaces graph_summary)
    const n = hits[0];
    const incoming = db.all(
      `SELECT e.*, src.label AS from_label FROM edges e
       JOIN nodes src ON src.id = e.from_id
       WHERE e.to_id = $id ORDER BY e.confidence DESC LIMIT 3`,
      { id: n.id }
    );
    const outgoing = db.all(
      `SELECT e.*, tgt.label AS to_label FROM edges e
       JOIN nodes tgt ON tgt.id = e.to_id
       WHERE e.from_id = $id ORDER BY e.confidence DESC LIMIT 3`,
      { id: n.id }
    );
    const edges = [
      ...incoming.map(e => ({ ...e, from_label: e.from_label })),
      ...outgoing.map(e => ({ ...e, to_label: e.to_label })),
    ];
    return renderCompact({ nodes: [n], edges });
  } finally {
    db.close();
  }
}
