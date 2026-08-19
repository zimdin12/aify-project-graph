// graph_whereis MUST STATE ITS POPULATION EVEN WHEN NOTHING WAS CAPPED.
//
// ⛔ FOUND BY THE FIRST CONTROLLED EFFICACY RUN (2026-08-19). The AUGMENTED arm asked
// graph_whereis for every definition of `detect` with limit=50 and got exactly 10 rows — with
// no truncation flag, no total, and no evidence banner. Its own words:
//
//   "From the output alone I could not distinguish 'the true count is 10' from 'an internal cap
//    of 10 clipped the list'. The verb that answers 'where is X defined' cannot itself license
//    'and that is all of them'."
//
// So it re-derived the answer with an independent text sweep and spent 15 tool calls to the
// baseline arm's 9 — for an identical, correct answer. The tool was not WRONG. It was
// UNWARRANTED, and the cost of that landed on the agent.
//
// ★ THE POPULATION WAS ALREADY KNOWN TO THE CODE. A COUNT over the same predicate was added on
// 2026-08-12 to fix the silent `limit=5` cap; it is surfaced ONLY when the result is capped.
// When nothing is capped the verb says nothing, so "10 rows" and "10 rows, and that is all of
// them" are the same output. That is the exact defect class fixed all week in graph_packet — a
// population the code holds and the reader never sees — left standing in the sibling verb.
// Enumerate every emitter, again.
//
// ⚠ And the basis travels with the number: whereis matches an EXACT LABEL over declaration
// types, so "10 of 10" is a claim about that predicate and must say so. A count whose predicate
// is unstated is the next version of this defect.
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

async function repoWith(n) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-wa-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  for (let i = 0; i < n; i += 1) {
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('n${i}','Function','detect','src/f${i}.js',${i + 1},${i + 2},'js',1,'{}')`);
  }
  db.close();
  return repo;
}

describe('graph_whereis attests its population', () => {
  it('★★★ an UNCAPPED result still states the total', async () => {
    // The eval case: 10 definitions, limit well above them, nothing truncated.
    repoRoot = await repoWith(10);
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 50 });
    expect(out, 'the reader must be able to tell 10-of-10 from 10-clipped')
      .toMatch(/10 of 10/);
  }, 20_000);

  it('★★★ the basis travels with the number', async () => {
    // A count whose predicate is unstated is the next version of this defect. whereis matches an
    // exact label over declaration types; the output has to say what the 10 are 10 OF.
    repoRoot = await repoWith(10);
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 50 });
    expect(out, 'name the predicate the count is over').toMatch(/exact label|declaration/i);
  }, 20_000);

  it('★★★ a CAPPED result still says so, and how to widen — no regression', async () => {
    // The 2026-08-12 fix must survive: this is the case that was silently returning five.
    repoRoot = await repoWith(12);
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 5 });
    expect(out).toMatch(/SHOWING 5 OF 12/);
    expect(out).toMatch(/limit=12/);
  }, 20_000);

  it('★★ a single definition reads as 1 of 1', async () => {
    // The commonest case, and the one where "is that all?" is asked most often.
    repoRoot = await repoWith(1);
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 50 });
    expect(out).toMatch(/1 of 1/);
  }, 20_000);

  it('★★ a no-match answer is unchanged — the negative half', async () => {
    // Attesting a population must not turn an honest "no match" into a claim of zero-of-zero.
    repoRoot = await repoWith(3);
    const out = await graphWhereis({ repoRoot, symbol: 'NoSuchSymbol', limit: 50 });
    expect(out).toMatch(/NO MATCH|no match/i);
    expect(out).not.toMatch(/0 of 0/);
  }, 20_000);
});
