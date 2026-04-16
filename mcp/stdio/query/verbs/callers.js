import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { rankCallers } from '../rank.js';
import { enforceBudget } from '../budget.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

export async function graphCallers({ repoRoot, symbol, depth = 1, top_k = 10, file }) {
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    // Find target node(s)
    const targets = db.all('SELECT id FROM nodes WHERE label = $label', { label: symbol });
    if (targets.length === 0) return 'NO MATCH';
    const targetIds = targets.map(t => t.id);

    // Gather incoming CALLS edges (depth 1 for now; recursive CTE for depth > 1)
    let edges;
    if (depth <= 1) {
      const placeholders = targetIds.map((_, i) => `$t${i}`).join(',');
      const params = {};
      targetIds.forEach((id, i) => { params[`t${i}`] = id; });
      edges = db.all(
        `SELECT e.*, n.label AS from_label, n.type AS from_type, n.file_path AS from_file, n.start_line AS from_line
         FROM edges e JOIN nodes n ON n.id = e.from_id
         WHERE e.to_id IN (${placeholders}) AND e.relation = 'CALLS'
         LIMIT 100`,
        params
      );
    } else {
      // Recursive CTE for multi-hop
      const tid = targetIds[0];
      edges = db.all(
        `WITH RECURSIVE callers(caller_id, depth) AS (
           SELECT from_id, 1 FROM edges WHERE to_id = $tid AND relation = 'CALLS'
           UNION ALL
           SELECT e.from_id, c.depth + 1 FROM edges e JOIN callers c ON e.to_id = c.caller_id
           WHERE e.relation = 'CALLS' AND c.depth < $depth AND c.depth <= 10
         )
         SELECT DISTINCT e.*, n.label AS from_label, n.type AS from_type, n.file_path AS from_file, n.start_line AS from_line, c.depth
         FROM callers c JOIN edges e ON e.from_id = c.caller_id JOIN nodes n ON n.id = e.from_id
         WHERE e.relation = 'CALLS'
         LIMIT 100`,
        { tid, depth }
      );
    }

    if (edges.length === 0) return 'NO CALLERS';

    let mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: 'CALLS',
      source_file: e.from_file, source_line: e.from_line,
      confidence: e.confidence, depth: e.depth ?? 1,
      from_type: e.from_type, fan_in: 1,
      from_label: e.from_label,
    }));
    // File scope filter: only show callers from a specific directory
    if (file) mapped = mapped.filter(e => e.source_file && e.source_file.startsWith(file));
    if (mapped.length === 0) return file ? `NO CALLERS from "${file}"` : 'NO CALLERS';
    const ranked = rankCallers(mapped);
    const { kept, dropped } = enforceBudget(ranked, top_k);
    return renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `top_k=${top_k + 10}` });
  } finally {
    db.close();
  }
}
