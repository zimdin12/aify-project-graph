// A RETRIEVAL LIMIT OF ZERO PRODUCED AN ANSWER SHAPED LIKE ABSENCE.
//
// ⛔ graph-senior-dev, 2026-08-19, executing against 528a68c: `graphWhereis(symbol:'graphWhereis',
// limit:0)` returns a NO MATCH-shaped response for a symbol whose Function node is right there.
// The schema accepts any integer (`limit: { type: 'integer', default: 5 }`).
//
// ★ It is a consequence of the single-query population design, which is otherwise the right
// design: `SELECT *, count(*) OVER () AS __population … LIMIT $limit` carries the total on the
// ROWS, so that rows and count cannot come from two WAL snapshots. With `LIMIT 0` there are no
// rows to carry it, `population` falls back to 0, and the miss branch runs. The fix must not be
// a second COUNT — that would reintroduce exactly the two-snapshot defect the window closed.
//
// ⇒ REFUSE, DO NOT GUESS. Clamping 0 up to 1 would silently answer a different question than
// the one asked. A request for zero rows cannot support a claim about a population, so the
// honest answer is to say the request is unanswerable and why — fail closed, in a verb whose
// whole job this month has been not making claims it cannot support.
//
// ⚠ SCOPE CHECKED, NOT ASSUMED: the six other limit-taking verbs (callers, callees, impact,
// search, explore, neighbors) were probed at limit=0 and none produces a false absence. This is
// bounded to whereis because whereis is the only site deriving a population from the rows.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphWhereis } from '../../../mcp/stdio/query/verbs/whereis.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function repoWithSymbol() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-lf-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 1, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('s1','Function','doThing','src/a.js',10,20,'javascript',1,'{}')`);
  db.close();
  return repo;
}

describe('graph_whereis with a limit below one', () => {
  for (const limit of [0, -1]) {
    it(`★★★ does not answer limit=${limit} with an absence claim about a symbol that exists`, async () => {
      repoRoot = await repoWithSymbol();
      const out = await graphWhereis({ repoRoot, symbol: 'doThing', limit });
      expect(out, 'the node is in the graph; a miss-shaped answer is a false statement')
        .not.toMatch(/NO MATCH/);
    }, 20_000);

    it(`★★★ says the limit is the problem, so the caller can fix the call`, async () => {
      repoRoot = await repoWithSymbol();
      const out = await graphWhereis({ repoRoot, symbol: 'doThing', limit });
      expect(out, 'a refusal that does not name its cause costs a debugging round trip')
        .toMatch(/limit/i);
    }, 20_000);
  }

  it('★★★ limit=1 still answers normally — the floor must not eat the valid boundary', async () => {
    repoRoot = await repoWithSymbol();
    const out = await graphWhereis({ repoRoot, symbol: 'doThing', limit: 1 });
    expect(out).toMatch(/doThing/);
    expect(out, 'the population line must still render at the boundary').toMatch(/1 of 1/);
  }, 20_000);
});
