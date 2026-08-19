// THE COUNT WAS OVER PATHS AND CLAIMED TO BE OVER EDGES.
//
// ⛔ FIELD REPORT (ef-manager, 2026-08-19, build 754223f). `graph_impact(symbol:
// "renderPacketLines")` at the default depth=3 rendered five EDGE rows, two of them
// byte-identical, and then stated `[5 edges found …]`. There are FOUR distinct edges.
//
// ★ They checked rather than assumed, which is why this is a finding and not a guess: an
// identical-looking pair can be two real call sites on one line. Source at packet.js:1450 is a
// single call; a direct DB query for that (from,to) pair returns ONE row; depth=1 shows no
// duplicate and depth=3 does.
//
// ⇒ MECHANISM: the recursive walk yields a row per PATH, and `SELECT DISTINCT … i.depth` keeps
// `depth` in the distinct key — so one edge reachable by two paths of different lengths
// survives twice. There is no edge-level visited set.
//
// ★★ THIS IS THE PROMOTION SHAPE FOR THE THIRD TIME, and ef-manager is right that it is no
// longer incidental: a cosmetic repeat becomes a FALSE ASSERTION the moment something states a
// count over the list. I deduped the packet NEXT list at emission this morning; its sibling
// emitter states a number over an un-deduped list.
//
// ⇒ THE COUNT AND THE DEDUP MUST COME FROM THE SAME OPERATION. Deduping in SQL — MIN(depth) per
// distinct edge — means the rows the reader sees and the number describing them cannot disagree,
// rather than being two places that have to be kept in step.
//
// ⚠ Severity, stated honestly: an inflated blast radius errs toward caution, so direct harm is
// low. What is not low is that the CONFIDENCE line is what a reader uses to calibrate everything
// else in the answer. A calibration number that can be wrong in the safe direction can be wrong
// in the other one.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

// A diamond: outer -> mid -> target AND outer -> target. `outer -> mid` is reachable at one
// depth directly and at another through the second arm, so a path-shaped walk emits it twice.
async function diamondRepo() {
  const r = await mkdtemp(join(tmpdir(), 'apg-imp-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 3, edges: 3, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  for (const [id, label] of [['t', 'target'], ['m', 'mid'], ['o', 'outer']]) {
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('${id}','Function','${label}','src/a.js',1,2,'javascript',1,'{}')`);
  }
  // ⚠ The edges table has NO `id` column and no `file_path`/`line` — the real columns are
  // from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor. My first
  // fixture invented three of them. A fixture whose schema does not match the subject's is the
  // apparatus-error class again: it exercises something the code never queries.
  const edge = (f, t, line) => db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ('${f}','${t}','CALLS','src/a.js',${line},0.9,'EXTRACTED','test')`);
  edge('m', 't', 10);   // mid   -> target
  edge('o', 'm', 20);   // outer -> mid
  edge('o', 't', 30);   // outer -> target  (the second arm of the diamond)
  db.close();
  return r;
}

describe('graph_impact edge accounting', () => {
  it('★★★ renders each distinct edge once, however many paths reach it', async () => {
    repoRoot = await diamondRepo();
    const out = await graphImpact({ repoRoot, symbol: 'target', depth: 3 });
    const edgeLines = out.split('\n').filter((l) => l.startsWith('EDGE'));
    expect(new Set(edgeLines).size, `a repeated EDGE row is a false statement about the graph:\n${edgeLines.join('\n')}`)
      .toBe(edgeLines.length);
  }, 20_000);

  it('★★★ there are exactly three edges in this graph and it must not report more', async () => {
    // The absolute check, not just internal consistency: a count can be self-consistent and
    // still wrong if BOTH the rows and the number are inflated together.
    repoRoot = await diamondRepo();
    const out = await graphImpact({ repoRoot, symbol: 'target', depth: 3 });
    const edgeLines = out.split('\n').filter((l) => l.startsWith('EDGE'));
    expect(edgeLines.length, 'three edges exist; the walk must not invent a fourth').toBeLessThanOrEqual(3);
  }, 20_000);

  it('★★★ depth=1 and depth=3 agree about the edges they share', async () => {
    // ef-manager's own discriminator: the duplicate appeared only at depth 3. If the two depths
    // disagree about an edge's existence, the walk is counting traversals, not edges.
    repoRoot = await diamondRepo();
    const shallow = await graphImpact({ repoRoot, symbol: 'target', depth: 1 });
    const deep = await graphImpact({ repoRoot, symbol: 'target', depth: 3 });
    for (const line of shallow.split('\n').filter((l) => l.startsWith('EDGE'))) {
      expect(deep.split('\n').filter((l) => l === line).length,
        `"${line}" appears once at depth=1 and must not multiply at depth=3`).toBe(1);
    }
  }, 20_000);
});
