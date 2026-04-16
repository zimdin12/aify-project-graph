import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

export async function graphSummary({ repoRoot, symbol }) {
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const rows = db.all('SELECT * FROM nodes WHERE label = $label LIMIT 1', { label: symbol });
    if (rows.length === 0) return 'NO NODE';
    const n = rows[0];

    // Top 3 incoming + 3 outgoing edges
    const incoming = db.all(
      `SELECT e.*, n.label AS from_label FROM edges e
       JOIN nodes n ON n.id = e.from_id
       WHERE e.to_id = $id LIMIT 3`,
      { id: n.id }
    );
    const outgoing = db.all(
      `SELECT e.*, n.label AS to_label FROM edges e
       JOIN nodes n ON n.id = e.to_id
       WHERE e.from_id = $id LIMIT 3`,
      { id: n.id }
    );

    const edges = [
      ...incoming.map(e => ({
        from_id: e.from_id, to_id: e.to_id, relation: e.relation,
        source_file: e.source_file, source_line: e.source_line, confidence: e.confidence,
      })),
      ...outgoing.map(e => ({
        from_id: e.from_id, to_id: e.to_id, relation: e.relation,
        source_file: e.source_file, source_line: e.source_line, confidence: e.confidence,
      })),
    ];

    return renderCompact({ nodes: [n], edges });
  } finally {
    db.close();
  }
}
