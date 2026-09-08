// ⛔ THE CONFIDENCE LINE CONTRADICTED ITSELF, ONE LINE APART, AND I WROTE BOTH HALVES.
//
// On a saturated result graph_callers printed:
//
//     CONFIDENCE: at least 100 (the fetch cap was reached, so this is a floor, not a total) callers …
//       ⚠ This list is NOT a floor. …
//
// Each sentence is defensible about a DIFFERENT NOUN. "at least 100" is a floor on the EDGE ROWS
// the query fetched — the cap was hit, so more rows exist. "NOT a floor" is about REAL CALLERS,
// which can be fewer than the rows suggest, because heuristic edges resolve calls BY NAME and
// unrelated same-named calls inflate the set. Both true; together, incoherent.
//
// ⭐ AND THE SIBLING VERB ALREADY HAD THE RIGHT NOUN. graph_impact prints the identical helper
// output as "edges found". Only this verb called the rows "callers", which is the stronger claim
// and the one an agent acts on.
//
// ⇒ THE REPAIR IS THE NOUN, NOT THE CAVEAT. The count the query established is a count of candidate
// edge rows. The caller-function total was never established and is now said to be unknown, which is
// where the FILTER decision lands: nothing is deleted from storage, and the answer stops asserting a
// total it cannot support.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// Written down rather than imported, so the fixture and the subject can disagree.
const CAP = 100;

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

/** `callerCount` distinct heuristic callers of one short-named target. */
async function fanInRepo(callerCount) {
  const r = await mkdtemp(join(tmpdir(), 'apg-rows-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: callerCount + 1, edges: callerCount,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  const node = (id, label) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','Function','${label}','src/a.js',1,2,'javascript',1,'{}')`);
  node('t', 'has');
  for (let i = 0; i < callerCount; i += 1) {
    node(`c${i}`, `caller${i}`);
    db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
            VALUES ('c${i}','t','CALLS','src/a.js',${i + 10},0.9,'EXTRACTED','test')`);
  }
  db.close();
  return r;
}

describe('a saturated result reports rows, and does not claim a caller total', () => {
  it('★★★ THE REAL CASE: the confidence line stops calling fetched rows "callers"', async () => {
    repoRoot = await fanInRepo(CAP + 20);
    const out = String(await graphCallers({ repoRoot, symbol: 'has', top_k: 5 }));

    // It must still disclose that the fetch saturated — removing the number is not the fix.
    expect(out).toMatch(/CONFIDENCE:/);
    expect(out).toMatch(/at least 100/);
    // ⛔ AND THE NOUN MUST BE THE ONE THE QUERY ESTABLISHED.
    expect(out).toMatch(/candidate edge rows/);
    expect(out, 'the caller-function total was never established').toMatch(/UNKNOWN|unknown/);
  });

  it('★★★ THE CONTRADICTION IS GONE: it never says "a floor" and "NOT a floor" together', async () => {
    repoRoot = await fanInRepo(CAP + 20);
    const out = String(await graphCallers({ repoRoot, symbol: 'has', top_k: 5 }));

    // The old text asserted both, one line apart. Whichever the reader believed, the other was
    // there to contradict it.
    const saysFloor = /this is a floor/.test(out);
    const saysNotFloor = /NOT a floor/.test(out);
    expect(saysFloor && saysNotFloor, 'the two sentences must not both appear').toBe(false);
  });

  it('★★★ BOTH DIRECTIONS OF THE CAVEAT SURVIVE — this is not a deletion', async () => {
    // The easy way to remove a contradiction is to delete one side. That would drop a true warning:
    // the list can be too small AND too large, for different reasons, and an agent needs both.
    repoRoot = await fanInRepo(CAP + 20);
    const out = String(await graphCallers({ repoRoot, symbol: 'has', top_k: 5 }));

    expect(out, 'can miss real callers').toMatch(/UNDERCOUNT/);
    expect(out, 'can include unrelated same-named calls').toMatch(/OVERCOUNT/);
    expect(out, 'and the remedy stays actionable').toMatch(/rg -n/);
  });

  it('★★★ THE DISCRIMINATING CONTROL: an UNSATURATED result carries no cap language at all', async () => {
    // Without this, a fix that printed the saturation caveat unconditionally would pass everything
    // above. A qualifier on every answer is decoration, and this repository has torn one out before.
    repoRoot = await fanInRepo(3);
    const out = String(await graphCallers({ repoRoot, symbol: 'has', top_k: 5 }));

    expectAbsentWithLiveMatcher(
      /at least/,
      { forbidden: 'CONFIDENCE: at least 100 candidate edge rows fetched', allowed: 'CONFIDENCE: 3 candidate edge rows fetched' },
      out,
      'an unsaturated fetch must not claim it was capped',
    );
  });
});
