// "WHAT DOES THIS GRAPH ACTUALLY CONTAIN?" — the question the field asked three times.
//
// ef-manager, after days of intensive use: they hand-wrote `SELECT type, count(*) FROM nodes
// GROUP BY type` in THREE separate rounds and it produced a finding every single time — the four
// dead declaration types, the 67%-unreachable figure, and echoes' 183 `Symbol` + 1 `BuildTest`
// that whereis silently cannot return. Their words:
//
//   "graph_health gives me nodes=4624 edges=15788 — two numbers that have never once told me
//    anything actionable — while the distribution behind them has been the most productive
//    thing I have run. This is not a feature request dressed as feedback. It is the thing I
//    worked around, three times, with a tool you did not ship."
//
// ⚠ NOT A NEW VERB. graph-senior-dev's roadmap ruling is explicit: "no new verb until the
// existing discovery journey cannot be expressed." It goes in `graph_health`, which is already
// the step-zero call and already opens the DB — so the census costs one extra query on a verb
// nobody calls in a loop.
//
// ⚠ AND NOT A RAW HISTOGRAM DUMP. Our own measured rule: behaviour changes when a field
// CONTRADICTS the agent's confidence, never when it merely adds data. `nodes=4624` invites the
// belief that the graph knows a lot about everything. The contradiction is the SHARE OF THE
// GRAPH THE SEARCH VERBS CANNOT RETURN, and the declaration types that are empty. That is what
// is emitted; the long tail is counted, not listed.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

// `rows` is [type, count] pairs.
async function repoWith(rows) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-census-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const total = rows.reduce((a, [, n]) => a + n, 0);
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: total, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  let id = 0;
  for (const [type, n] of rows) {
    for (let i = 0; i < n; i += 1, id += 1) {
      db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
              VALUES ('n${id}','${type}','sym${id}','src/a.js',1,2,'javascript',1,'{}')`);
    }
  }
  db.close();
  return repo;
}

const text = (out) => (typeof out === 'string' ? out : JSON.stringify(out));

describe('graph_health population census', () => {
  it('★★★ reports the DISTRIBUTION, not just a total', async () => {
    repoRoot = await repoWith([['Function', 6], ['Document', 3], ['External', 2]]);
    const out = text(await graphHealth({ repoRoot }));
    expect(out, 'nodes=11 is the number that never told anyone anything').toMatch(/Function 6/);
    expect(out).toMatch(/Document 3/);
  }, 20_000);

  it('★★★ names the share the search verbs CANNOT return — the contradiction', async () => {
    // 6 of 11 nodes are Document/External/Directory: real content that graph_whereis will never
    // return, because it matches over declaration types only. That is the fact which contradicts
    // "the graph has 11 nodes so it knows about 11 things".
    repoRoot = await repoWith([['Function', 5], ['Document', 3], ['External', 2], ['Directory', 1]]);
    const out = text(await graphHealth({ repoRoot }));
    expect(out, 'the unreachable share is the actionable half').toMatch(/6 of 11|55%/);
  }, 20_000);

  it('★★★ names the declaration types that are EMPTY here', async () => {
    // The finding ef-manager got twice by hand: a searched type with zero nodes cannot ever
    // match, so asking this verb about one is guaranteed to fail.
    repoRoot = await repoWith([['Function', 4]]);
    const out = text(await graphHealth({ repoRoot }));
    expect(out).toMatch(/Variable/);
    expect(out).toMatch(/Interface/);
  }, 20_000);

  it('★★★ says nothing about emptiness when nothing is empty', async () => {
    // The unwarranted-doubt rule. A census that always warns is a census nobody reads.
    const all = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Variable', 'Test', 'Route', 'Entrypoint'];
    repoRoot = await repoWith(all.map((t) => [t, 1]));
    const out = text(await graphHealth({ repoRoot }));
    expect(out, 'no type is empty, so none may be listed as empty')
      .not.toMatch(/have NO nodes|zero nodes/i);
  }, 20_000);

  it('★★★ does not list a long tail it only counted', async () => {
    // Budget discipline: health is called at session start on every session. The top types earn
    // their line; the rest are a number.
    repoRoot = await repoWith([
      ['Function', 9], ['Method', 8], ['Class', 7], ['Module', 6], ['File', 5],
      ['Document', 4], ['Config', 3], ['Test', 2], ['Route', 1],
    ]);
    const out = text(await graphHealth({ repoRoot }));
    expect(out, 'the tail is counted, not enumerated').toMatch(/\+\d+ more/);
  }, 20_000);
});
