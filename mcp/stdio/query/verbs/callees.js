import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { rankCallees } from '../rank.js';
import { enforceBudget } from '../budget.js';
import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';
import { selectBestRoot } from './path.js';
import { ensureFreshForReadVerb } from './read_freshness.js';

const EXECUTION_RELATIONS = ['CALLS', 'INVOKES', 'PASSES_THROUGH'];

export async function graphCallees({ repoRoot, symbol, depth = 1, top_k = 10, file }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  const freshnessWarning = await ensureFreshForReadVerb({ repoRoot, verbName: 'graph_callees' });
  if (freshnessWarning) return freshnessWarning;
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const sources = resolveSymbol(db, symbol);
    if (sources.length === 0) return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;
    const ambiguity = buildAmbiguousMatchMessage(symbol, sources);
    if (ambiguity) return ambiguity;
    const root = selectBestRoot(sources);
    const sourceIds = [root.id];

    let edges;
    if (depth <= 1) {
      const placeholders = sourceIds.map((_, i) => `$s${i}`).join(',');
      const params = {};
      sourceIds.forEach((id, i) => { params[`s${i}`] = id; });
      edges = db.all(
        `SELECT e.*, n.label AS to_label, n.type AS to_type, n.file_path AS to_file, n.start_line AS to_line
         FROM edges e JOIN nodes n ON n.id = e.to_id
         WHERE e.from_id IN (${placeholders}) AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
         LIMIT 100`,
        params
      );
    } else {
      const sid = root.id;
      edges = db.all(
        `WITH RECURSIVE callees(from_id, to_id, depth) AS (
           SELECT from_id, to_id, 1
           FROM edges
           WHERE from_id = $sid AND relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
           UNION ALL
           SELECT e.from_id, e.to_id, c.depth + 1
           FROM edges e
           JOIN callees c ON e.from_id = c.to_id
           WHERE e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')}) AND c.depth < $depth AND c.depth <= 10
         )
         SELECT DISTINCT e.*, n.label AS to_label, n.type AS to_type, n.file_path AS to_file, n.start_line AS to_line, c.depth
         FROM callees c
         JOIN edges e
           ON e.from_id = c.from_id
          AND e.to_id = c.to_id
          AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
         JOIN nodes n ON n.id = e.to_id
         LIMIT 100`,
        { sid, depth }
      );
    }

    if (edges.length === 0) return `NO CALLEES for "${symbol}". Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`;

    let mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      source_file: e.to_file, source_line: e.to_line,
      confidence: e.confidence,
      provenance: e.provenance ?? 'EXTRACTED',
      depth: e.depth ?? 1,
      from_type: 'Function', fan_in: 1,
      to_label: e.to_label,
    }));
    if (file) mapped = mapped.filter(e => e.source_file && e.source_file.startsWith(file));
    if (mapped.length === 0) return file ? `NO CALLEES in "${file}"` : `NO CALLEES for "${symbol}". Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`;
    const ranked = rankCallees(mapped);
    const { kept, dropped } = enforceBudget(ranked, top_k);
    return renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `top_k=${top_k + 10}` });
  } finally {
    db.close();
  }
}
