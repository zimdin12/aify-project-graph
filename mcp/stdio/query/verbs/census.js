// THE DISTRIBUTION, NOT THE TOTALS.
//
// ⭐ THE ONE VERB THE FIELD EARNED. the field test hand-wrote `SELECT type, count(*) FROM nodes GROUP
// BY type` in THREE separate review rounds and it produced a finding every time: four dead
// declaration types, the 67%-unreachable figure, and echoes' 183 `Symbol` + 1 `BuildTest` nodes
// that `graph_whereis` silently cannot return. Their words:
//
//   "graph_health gives me nodes=4624 edges=15788 — two numbers that have never once told me
//    anything actionable — while the DISTRIBUTION behind them has been the most productive thing
//    I have run."
//
// The roadmap bars new verbs "until the discovery journey cannot be expressed without one". This
// one is not a feature request dressed as feedback: the query was run by hand three times because
// nothing exposed it, and each run found a defect.
//
// ⛔ AND THE VALUE IS NOT THE COUNTS. It is the TWO-WAY COMPARISON between what the taxonomy
// DECLARES and what the graph CONTAINS. A count of 12 node types tells you nothing; a type the
// code can emit and never has is a dead branch, and a type in the database that the taxonomy does
// not declare is a consumer about to receive something it has no case for. Both are invisible in
// any single-direction listing, and both are how every one of those three findings arrived.
//
// This is the enumeration-vs-detection rule applied to the schema itself: do not list what you
// expect, DIFF the declared vocabulary against the observed one, in both directions.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { NODE_TYPES, RELATIONS, EDGE_PROVENANCE_TYPES } from '../../storage/taxonomy.js';

/**
 * Compare a declared vocabulary against what a table actually holds.
 *
 * ⛔ BOTH DIRECTIONS, ALWAYS. `declared_but_empty` finds code paths that never fire — a rule whose
 * population is zero is a different rule than the one documented. `present_but_undeclared` finds
 * values reaching consumers that no consumer has a case for. Reporting only the first would make
 * an unknown type look like a clean graph.
 */
export function diffVocabulary(declared, observedCounts) {
  const observed = new Map(observedCounts.map((r) => [r.key, r.count]));
  return {
    declared_but_empty: declared.filter((d) => !observed.has(d) || observed.get(d) === 0).sort(),
    present_but_undeclared: [...observed.keys()].filter((k) => !declared.includes(k)).sort(),
  };
}

/** Every declared value with its count, INCLUDING the zeros — an absent row is not a zero. */
function withZeros(declared, rows) {
  const seen = new Map(rows.map((r) => [r.key, r.count]));
  const out = declared.map((d) => ({ key: d, count: seen.get(d) ?? 0 }));
  // Anything observed but not declared is appended and FLAGGED, never silently dropped: a value
  // the taxonomy does not know about is the most interesting row in the table.
  for (const [k, count] of seen) {
    if (!declared.includes(k)) out.push({ key: k, count, undeclared: true });
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * A census of the graph: what it contains, what it declares, and where the two disagree.
 *
 * @param {object} db  an open graph database
 */
export function buildCensus(db) {
  const group = (table, column) => db.all(
    `SELECT ${column} AS key, COUNT(*) AS count FROM ${table}
      WHERE ${column} IS NOT NULL AND ${column} != ''
      GROUP BY ${column}`);

  const nodeRows = group('nodes', 'type');
  const edgeRows = group('edges', 'relation');
  const provRows = group('edges', 'provenance');
  const extractorRows = group('edges', 'extractor');

  const totalNodes = nodeRows.reduce((a, r) => a + r.count, 0);
  const totalEdges = edgeRows.reduce((a, r) => a + r.count, 0);

  return {
    // ⚠ The totals are here because a reader will ask, and BECAUSE they must reconcile against the
    // distribution. A total that does not equal the sum of its parts means a row was filtered out
    // of one and not the other — which is how a census stops being one.
    totals: { nodes: totalNodes, edges: totalEdges },

    nodes_by_type: withZeros([...NODE_TYPES], nodeRows),
    edges_by_relation: withZeros([...RELATIONS], edgeRows),
    edges_by_provenance: withZeros([...EDGE_PROVENANCE_TYPES], provRows),
    // ⭐ EXTRACTORS ARE NOT A DECLARED VOCABULARY AND THAT IS THE POINT. Every producer names
    // itself in this column, so the list IS the set of things currently writing to the graph.
    // A retired extractor still holding edges shows up here and nowhere else — which is exactly
    // the state `mentions` was in for months.
    edges_by_extractor: extractorRows.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),

    vocabulary_drift: {
      node_types: diffVocabulary([...NODE_TYPES], nodeRows),
      relations: diffVocabulary([...RELATIONS], edgeRows),
      provenance: diffVocabulary([...EDGE_PROVENANCE_TYPES], provRows),
    },

    how_to_read: [
      'declared_but_empty  — the code can emit this and never has. A dead branch, or a rule whose',
      '                      population is zero. Four of these were a real finding on this repo.',
      'present_but_undeclared — the database holds a value the taxonomy does not know about, so a',
      '                      consumer switching on it has no case for it and will silently skip.',
      'edges_by_extractor  — the set of producers currently writing. A retired extractor still',
      '                      holding edges appears here and in no other view.',
      '',
      'The totals must equal the sum of each distribution. If they do not, a row was filtered from',
      'one and not the other.',
    ],
  };
}

/**
 * The verb. Deliberately takes no arguments beyond the repo: a census with a filter is a query,
 * and the whole value here is seeing the WHOLE distribution at once.
 *
 * ⚠ IT DOES NOT REFRESH. `ensureFresh` would rebuild the graph before counting it, which means the
 * census could never show you the state you are asking about — you would always be told about the
 * graph as it is AFTER the tool decided to fix it. Reporting the snapshot as it stands is the point;
 * `graph_health` is the verb that tells you whether that snapshot is stale.
 */
export async function graphCensus({ repoRoot }) {
  const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
  if (!existsSync(dbPath)) {
    return {
      indexed: false,
      summary: 'No graph at .aify-graph/graph.sqlite. Run graph_index().',
    };
  }
  // ⛔ `openExistingDb`, NOT `openDb`. This verb only ever calls `db.all()`, so a writable handle was
  // wrong on its own terms — but it also meant a census could be counted straight out of a
  // half-built graph. A full rebuild empties the node and edge tables before refilling them, and
  // this verb reports counts: it is the single worst place to answer from that window, because a
  // census IS a claim about what exists. Measured: it answered 2,922 bytes during a marked rebuild
  // while 24 other verbs correctly refused.
  let db;
  try {
    db = openExistingDb(dbPath);
  } catch (err) {
    if (err?.code !== 'GRAPH_REBUILD_IN_PROGRESS') throw err;
    return { indexed: false, rebuildInProgress: true, summary: err.message };
  }
  try {
    return { indexed: true, ...buildCensus(db) };
  } finally {
    db.close();
  }
}
