import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';
import { noMatchMessage } from '../did-you-mean.js';

export const SEARCH_TYPES = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Variable', 'Test', 'Route', 'Entrypoint'];

export async function graphWhereis({ repoRoot, symbol, limit = 5, expand = false }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_whereis' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const hits = db.all(
      `SELECT * FROM nodes WHERE label = $label AND type IN (${SEARCH_TYPES.map(t => `'${t}'`).join(',')}) LIMIT $limit`,
      { label: symbol, limit }
    );
    if (hits.length === 0) {
      // Suggest, do not redirect. This path was missed when did-you-mean landed on
      // callers/callees/impact/change_plan — and graph_whereis is the verb a field
      // user actually reached for, so the fix covered four verbs nobody hit and
      // skipped the one they did (ef-manager, 2026-07-31). Same "the fix reached
      // one path" shape this codebase keeps producing; the lesson is to enumerate
      // every emitter of a message rather than the ones that come to mind.
      const base = noMatchMessage(db, symbol);
      const caveat = staleNotFoundCaveat(freshness);
      return caveat ? `${base}\n${caveat}` : base;
    }

    if (!expand) {
      return prefixReadWarnings(renderCompact({ nodes: hits, edges: [] }), freshness.warnings);
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
    return prefixReadWarnings(renderCompact({ nodes: [n], edges }), freshness.warnings);
  } finally {
    db.close();
  }
}
