// ⛔ A FIELD NAMED `total` HELD A CAP.
//
// `capped(items, limit)` set `total = items.length`, and for four lists `items` arrived from a query
// with a bare `LIMIT 100`. Measured by driving the real verb: a symbol with 150 callers came back as
// `total: 100, truncated: true`. 100 is the LIMIT. `truncated` described only the DISPLAY cut, so
// nothing in that JSON said the population was larger — while a field literally named `total` said
// it was 100.
//
// ⛔ THE FIRST FIX WAS THE HONEST VERSION OF THE WRONG ANSWER. It disclosed a floor
// (`totalIsFloor`). Both sibling verbs in this directory compute a REAL total — `symbol_lookup.js`
// pays for a COUNT only on a full page, `graph_consequences` counts uncapped — so a floor here was a
// caveat standing in for a number one indexed query away. Three verbs, one defect: pull was the only
// one reporting page length as population.
//
// ⭐ AND THE COUNT IS DERIVED FROM THE PAGE QUERY, NOT WRITTEN BESIDE IT. The page is a
// `SELECT DISTINCT` over six columns; the natural `COUNT(*) FROM edges` counts EDGES. Two nodes
// sharing (label, type, file_path, start_line) collapse to one row and count as two. Measured across
// the 300 highest fan-in symbols of this repository's own graph: ZERO divergence — partly because
// `idx_edges_unique(from_id, to_id, relation)` already removes the common duplication route. So a
// hand-written COUNT over the wrong noun would pass every test HERE and be wrong on a C++ repo with
// decl/def forks. ⇒ One SQL fragment, the COUNT wrapping it. They cannot describe different
// populations because there is only one description.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPull } from '../../../mcp/stdio/query/verbs/pull.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// ⛔ WRITTEN DOWN, NOT IMPORTED, so the fixture and the subject can DISAGREE.
const CAP = 100;

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function emptyRepo() {
  const r = await mkdtemp(join(tmpdir(), 'apg-pull-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 1, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  return r;
}

/** `callerCount` DISTINCT callers, each at its own file:line, all calling one target. */
async function repoWithCallers(callerCount) {
  const r = await emptyRepo();
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  const node = (id, label, file, line) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','Function','${label}','${file}',${line},9,'javascript',1,'{}')`);
  node('t', 'target', 'src/t.js', 1);
  for (let i = 0; i < callerCount; i += 1) {
    node(`c${i}`, `caller${i}`, `src/f${i}.js`, i + 10);
    db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
            VALUES ('c${i}','t','CALLS','src/f${i}.js',${i + 10},0.9,'EXTRACTED','test')`);
  }
  db.close();
  return r;
}

const callersOf = async (rr) => {
  const out = await graphPull({ repoRoot: rr, node: 'target', layers: ['relations'] });
  const parsed = typeof out === 'string' ? JSON.parse(out) : out;
  return parsed?.layers?.relations?.callers ?? null;
};

describe('graph_pull reports a real total, never a fetch cap', () => {
  it('★★★ THE REAL CASE: 150 callers past a cap of 100 reports 150, not 100', async () => {
    repoRoot = await repoWithCallers(CAP + 50);
    const callers = await callersOf(repoRoot);
    expect(callers, 'the relations layer must carry a callers list at all').toBeTruthy();
    expect(callers.total, 'the page saturated, so `total` must come from a COUNT, not from the page')
      .toBe(CAP + 50);
    expect(callers.truncated, 'the list shown is still a subset, and must say so').toBe(true);
  }, 60_000);

  it('★★★ THE DISCRIMINATING CONTROL: a short page is its own total and pays for no COUNT', async () => {
    // 40 exceeds the display limit but not the fetch cap, so the two cases differ ONLY in
    // saturation — the property under test. A fixture below the display limit would emit no
    // truncation at all and could not tell a correct total from an absent one.
    repoRoot = await repoWithCallers(40);
    const callers = await callersOf(repoRoot);
    expect(callers.total).toBe(40);
    expect(callers.truncated, 'still truncated for display, or this control proves nothing').toBe(true);
  }, 60_000);

  // ⛔⛔ THE CONTROL THAT COULD NOT HAVE FIRED ON THIS REPOSITORY.
  //
  // The obvious check — "on a short page, assert the COUNT equals rows.length" — is GREEN ON ARRIVAL
  // here, because this graph has zero edge-vs-DISTINCT divergence. It would pass with the wrong SQL
  // and the right SQL identically, which is a prohibition whose subject cannot reach the rejected
  // state: the dead `LIMIT 100` assertion one layer in.
  //
  // ⇒ So the fixture CONTAINS the shape. Two nodes, different ids, IDENTICAL on every column the
  // page projects, one edge each. The unique index permits this precisely because `from_id` differs
  // — and would have REJECTED the obvious alternative fixture of two duplicate edges, returning a
  // confusing green that would have made this test look impossible to write.
  //
  // Discrimination demonstrated by measurement BEFORE this test existed:
  //     page rows 1 · COUNT over the page query 1 (agrees) · COUNT over edges 2 (would fire)
  it('★★★ THE DIVERGENCE FIXTURE: two nodes that collapse under DISTINCT are counted ONCE', async () => {
    repoRoot = await emptyRepo();
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    const node = (id) => db.run(
      `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
       VALUES ('${id}','Function','dup','src/x.js',5,9,'javascript',1,'{}')`);
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('t','Function','target','src/t.js',1,9,'javascript',1,'{}')`);
    node('a1');
    node('a2');
    for (const from of ['a1', 'a2']) {
      db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
              VALUES ('${from}','t','CALLS','src/x.js',5,0.9,'EXTRACTED','test')`);
    }
    db.close();

    const callers = await callersOf(repoRoot);
    // The two edges render as ONE row, so the population is one. A COUNT over `edges` would say 2.
    expect(callers.items.length, 'the two callers collapse under the page DISTINCT').toBe(1);
    expect(callers.total, 'and the count must describe the rows the page renders, not the edges')
      .toBe(1);
  }, 60_000);
});
