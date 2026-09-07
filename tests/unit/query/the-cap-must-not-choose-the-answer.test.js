// ⛔ THE FETCH CAP DECIDED WHICH CALLERS EXIST, BEFORE SCOPE AND BEFORE RANKING.
//
// `graph_callers` fetched with a bare `LIMIT EDGE_FETCH_CAP + 1` and NO `ORDER BY`, sliced to the
// cap, and only then applied the `file` scope filter and `rankCallers`. So SQLite's arbitrary return
// order chose the population: a verified, in-scope caller sitting past the cut was discarded before
// anything that cares about it ever ran, and the verb then printed
//
//     NO CALLERS from "<dir>"
//
// which callers.js itself calls the most dangerous output it can produce — an absence claim about
// the repository, made because a LIMIT truncated arbitrarily.
//
// ⭐ AND THE FIX ALREADY EXISTED IN THE SIBLING VERB. callees.js carries the same cap with the
// ordering already mirrored and a comment spelling out this exact failure: "a verified edge late in
// the body must not be dropped by LIMIT in favour of a heuristic one early in it. Without any ORDER
// BY at all this LIMIT truncated arbitrarily." One verb was repaired and the other was not, which is
// the second time this session a "both verbs" claim was wrong on the file that was not opened.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// Written down rather than imported, so the fixture and the subject can DISAGREE. Importing the
// constant would make this test agree with any cap the subject happens to hold.
const CAP = 100;

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

/**
 * A repo where the ONE caller worth finding is inserted last, behind `noise` heuristic callers that
 * live in a different directory. Natural rowid order therefore puts it past the fetch cap.
 */
async function repoWithABuriedVerifiedCaller(noise) {
  const r = await mkdtemp(join(tmpdir(), 'apg-cap-order-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: noise + 2, edges: noise + 1,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  const node = (id, label, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','Function','${label}','${file}',1,2,'javascript',1,'{}')`);
  const edge = (from, prov) => db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ('${from}','t','CALLS','src/noise/n.js',1,0.9,'${prov}','test')`);

  node('t', 'target', 'src/core/target.js');
  for (let i = 0; i < noise; i += 1) {
    node(`n${i}`, `noise${i}`, 'src/noise/n.js');
    edge(`n${i}`, 'EXTRACTED');
  }
  // Inserted LAST and in its own directory: the one an agent asked for.
  node('w', 'wantedCaller', 'src/wanted/w.js');
  edge('w', 'LSP_VERIFIED');
  db.close();
  return r;
}

describe('the fetch cap must not choose the answer', () => {
  it('★★★ A VERIFIED IN-SCOPE CALLER PAST THE CAP IS STILL FOUND, not reported as absent', async () => {
    repoRoot = await repoWithABuriedVerifiedCaller(CAP + 20);
    const out = String(await graphCallers({ repoRoot, symbol: 'target', file: 'src/wanted' }));

    // The failure this catches is a FALSE ABSENCE, so assert the absence headline is gone by name.
    expect(out).not.toMatch(/NO CALLERS from/);
    expect(out).toMatch(/wantedCaller/);
  });

  it('★★★ THE DISCRIMINATING CONTROL: a scope with genuinely nothing in it still says so', async () => {
    // Without this, the assertion above would pass on a verb that had simply stopped filtering at
    // all. A correct silence and a dead filter look identical from the first test alone.
    repoRoot = await repoWithABuriedVerifiedCaller(CAP + 20);
    const out = String(await graphCallers({ repoRoot, symbol: 'target', file: 'src/nowhere' }));

    expect(out).toMatch(/NO CALLERS from/);
    expect(out).not.toMatch(/wantedCaller/);
  });

  it('★★ the verified caller outranks the heuristic noise even with no file filter', async () => {
    // The same defect without a scope argument: the highest-quality edge in the graph is the one the
    // arbitrary LIMIT was free to drop.
    repoRoot = await repoWithABuriedVerifiedCaller(CAP + 20);
    const out = String(await graphCallers({ repoRoot, symbol: 'target', top_k: 5 }));

    expect(out).toMatch(/wantedCaller/);
  });

  it('★ a small graph is unaffected — the repair must not change under-cap behaviour', async () => {
    // The positive control on the ordinary path: nothing here saturates, and every caller shows.
    repoRoot = await repoWithABuriedVerifiedCaller(3);
    const out = String(await graphCallers({ repoRoot, symbol: 'target', file: 'src/wanted' }));

    expect(out).toMatch(/wantedCaller/);
    expect(out).not.toMatch(/NO CALLERS/);
  });
});
