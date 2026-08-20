// THE DISTRIBUTION, NOT THE TOTALS — AND THE DRIFT, NOT THE DISTRIBUTION.
//
// ⭐ ef-manager hand-wrote `SELECT type, count(*) FROM nodes GROUP BY type` in THREE separate
// review rounds, because nothing exposed it, and it produced a finding every time: four dead
// declaration types, the 67%-unreachable figure, and echoes' 183 `Symbol` + 1 `BuildTest` nodes
// that `graph_whereis` silently cannot return.
//
//   "graph_health gives me nodes=4624 edges=15788 — two numbers that have never once told me
//    anything actionable — while the DISTRIBUTION behind them has been the most productive thing
//    I have run."
//
// ⛔ AND THE VALUE IS NOT THE COUNTS. It is the two-way diff between what the taxonomy DECLARES and
// what the graph CONTAINS. A type the code can emit and never has is a dead branch; a type in the
// database the taxonomy does not declare is a consumer with no case for it. Both are invisible in
// any one-directional listing, and both are how those three findings arrived.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCensus, diffVocabulary, graphCensus } from '../../../mcp/stdio/query/verbs/census.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { NODE_TYPES } from '../../../mcp/stdio/storage/taxonomy.js';

let repo;
afterEach(async () => {
  if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } }
  repo = undefined;
});

async function fixture() {
  repo = await mkdtemp(join(tmpdir(), 'apg-census-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  const node = (id, type) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','${type}','l${id}','src/${id}.js',1,1,'js_ts',1,'{}')`);
  node('a', 'Function');
  node('b', 'Function');
  node('c', 'Class');
  // ⛔ A TYPE THE TAXONOMY DOES NOT DECLARE. This is the row a reader most needs to see, and the
  // one a "list the declared types with their counts" implementation drops on the floor.
  node('d', 'Wormhole');
  db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ('a','b','CALLS','src/a.js',1,1,'EXTRACTED','javascript')`);
  return db;
}

describe('the census reports the distribution and the drift', () => {
  it('★★★ a DECLARED type with no rows is present as a ZERO, not absent', async () => {
    // ⛔ THE WHOLE POINT. `GROUP BY type` returns no row for a type with no instances, so a naive
    // census cannot distinguish "this type has none" from "this type does not exist". Those are
    // completely different diagnoses when a query came back empty, and the second one is a defect.
    const db = await fixture();
    const c = buildCensus(db);
    const byKey = Object.fromEntries(c.nodes_by_type.map((r) => [r.key, r.count]));
    for (const t of NODE_TYPES) {
      expect(byKey, `every declared type must appear, including ${t}`).toHaveProperty(t);
    }
    expect(byKey.Function).toBe(2);
    expect(byKey.Route, 'declared, nothing emitted it, still listed').toBe(0);
    db.close();
  }, 20_000);

  it('★★★ an UNDECLARED type in the database is surfaced and FLAGGED', async () => {
    // The other direction. A value the taxonomy does not know about reaches consumers that switch
    // on type and have no case for it — they skip it silently. Dropping the row because it is not
    // on the declared list would hide exactly the thing worth seeing.
    const db = await fixture();
    const c = buildCensus(db);
    const wormhole = c.nodes_by_type.find((r) => r.key === 'Wormhole');
    expect(wormhole, 'an unknown type must not be silently dropped').toBeTruthy();
    expect(wormhole.undeclared, 'and it must be marked as unknown, not blended in').toBe(true);
    expect(c.vocabulary_drift.node_types.present_but_undeclared).toContain('Wormhole');
    db.close();
  }, 20_000);

  it('★★★ the totals RECONCILE against the distribution', async () => {
    // A total that does not equal the sum of its parts means a row was filtered from one and not
    // the other — which is how a census stops being one. This is the same reconciliation the sweep
    // counters carry, applied to the thing that reports on them.
    const db = await fixture();
    const c = buildCensus(db);
    expect(c.nodes_by_type.reduce((a, r) => a + r.count, 0)).toBe(c.totals.nodes);
    expect(c.edges_by_relation.reduce((a, r) => a + r.count, 0)).toBe(c.totals.edges);
    db.close();
  }, 20_000);

  it('★★★ diffVocabulary reports BOTH directions, and neither implies the other', async () => {
    // A pure unit on the comparison itself, because it is the part that carries the finding. Both
    // arrays populated from one input, so an implementation that computes one and returns the other
    // twice cannot pass.
    const d = diffVocabulary(['Alpha', 'Beta'], [{ key: 'Beta', count: 3 }, { key: 'Gamma', count: 1 }]);
    expect(d.declared_but_empty, 'Alpha is declared and absent').toEqual(['Alpha']);
    expect(d.present_but_undeclared, 'Gamma is present and undeclared').toEqual(['Gamma']);
  });

  it('★★★ a count of ZERO is declared_but_empty, not merely a missing key', async () => {
    // The subtle half: a row that EXISTS with count 0 must be treated the same as no row at all.
    // An implementation testing only `!observed.has(d)` passes every other test in this file.
    const d = diffVocabulary(['Alpha'], [{ key: 'Alpha', count: 0 }]);
    expect(d.declared_but_empty).toEqual(['Alpha']);
  });

  it('★★★ no graph answers "not indexed" rather than throwing or reporting zeros', async () => {
    // ⛔ A census of a missing graph that returned all-zeros would be indistinguishable from a
    // census of an empty one, and the reader would conclude the repo has no functions.
    repo = await mkdtemp(join(tmpdir(), 'apg-census-none-'));
    const res = await graphCensus({ repoRoot: repo });
    expect(res.indexed).toBe(false);
    expect(res.totals, 'no totals at all, rather than zeros that read as a measurement')
      .toBeUndefined();
  }, 20_000);
});
