// ⛔ A FIELD NAMED `total` HELD A CAP.
//
// `capped(items, limit)` in pull.js set `total = items.length`, and for four lists `items` arrived
// from a query with a bare `LIMIT 100`. Measured 2026-09-07 by driving the real verb: a symbol with
// 150 callers came back as `total: 100, truncated: true`. 100 is the LIMIT. `truncated` only ever
// described the DISPLAY cut, so nothing in that JSON said the population was larger — while a field
// literally named `total` said it was 100.
//
// ⛔ AND I ALMOST DID NOT LOOK. These four caps were deferred the night before with the reason "they
// feed no remainder marker, so lower severity". That reason was wrong, and it was a READ rather than
// a measurement: a `total` in machine-readable output is a STRONGER claim than a rendered remainder,
// not a weaker one. ⭐ THE DEFERRAL SURVIVED BECAUSE NOBODY CHECKED THE REASON, WHICH IS THE SAME
// SHAPE AS THE DEFECT — a number nobody asked what it was a number OF.
//
// ⭐ AND THE FILE ALREADY KNEW, TWICE. Its own comments say "a capped LIST is a floor in exactly the
// way the closure cap is" and, for the transitive walk, "A full page of rows means 'there may be
// more', always." The principle was written down adjacent to the helper that violated it. A comment
// is not an instrument.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPull } from '../../../mcp/stdio/query/verbs/pull.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// ⛔ WRITTEN DOWN, NOT IMPORTED — so the fixture and the subject can DISAGREE. Importing
// PULL_FETCH_CAP would make a cap silently changed to 5 still "saturate", and every assertion here
// would keep agreeing with whatever the subject said.
const CAP = 100;

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function repoWithCallers(callerCount) {
  const r = await mkdtemp(join(tmpdir(), 'apg-pull-'));
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
  node('t', 'target');
  for (let i = 0; i < callerCount; i += 1) {
    node(`c${i}`, `caller${i}`);
    db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
            VALUES ('c${i}','t','CALLS','src/a.js',${i + 10},0.9,'EXTRACTED','test')`);
  }
  db.close();
  return r;
}

const callersOf = async (rr) => {
  const out = await graphPull({ repoRoot: rr, node: 'target', layers: ['relations'] });
  const parsed = typeof out === 'string' ? JSON.parse(out) : out;
  return parsed?.layers?.relations?.callers ?? null;
};

describe('graph_pull never reports a fetch cap as a total', () => {
  it('★★★ THE REAL CASE: 150 callers against a cap of 100 discloses that total is a floor', async () => {
    repoRoot = await repoWithCallers(CAP + 50);
    const callers = await callersOf(repoRoot);
    expect(callers, 'the relations layer must carry a callers list at all').toBeTruthy();
    expect(callers.totalIsFloor, 'the query saturated, so `total` is a floor and must say so').toBe(true);
    // ⚠ `total` staying at the cap is CORRECT — it is the number of rows this query can see. What
    // was wrong was announcing it with nothing to say it was a ceiling.
    expect(callers.total).toBe(CAP);
  }, 60_000);

  it('★★★ THE DISCRIMINATING CONTROL: an unsaturated list reports a true total, not a floor', async () => {
    // ⛔ Without this, a `capped()` that marked EVERYTHING a floor would pass the test above, and a
    // caveat on every answer is decoration — this repository has shipped one and had to tear it out.
    // 40 exceeds the display limit, so the list is still truncated for rendering: the two cases
    // differ ONLY in saturation, which is the property under test.
    repoRoot = await repoWithCallers(40);
    const callers = await callersOf(repoRoot);
    expect(callers.totalIsFloor, 'nothing saturated, so a floor here would be decoration').toBe(false);
    expect(callers.total, 'and the total is the real population').toBe(40);
    expect(callers.truncated, 'still truncated for display, or this control proves nothing').toBe(true);
  }, 60_000);

  it('★★ an in-memory list is never asked whether it saturated', async () => {
    // 26 of the 30 `capped()` call sites take an array that IS the population. They pass no
    // fetchCap, and must not acquire a floor they cannot have — the reason the parameter is optional
    // here rather than required as it is in renderCompact, where five of seven callers report a
    // remainder and the question is always meaningful.
    repoRoot = await repoWithCallers(3);
    const callers = await callersOf(repoRoot);
    expect(callers.totalIsFloor).toBe(false);
    expect(callers.total).toBe(3);
  }, 60_000);
});
