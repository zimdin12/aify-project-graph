// ⛔ THE PROCESS-STALENESS CHANNEL WAS BUILT AND NEVER WIRED.
//
// `server-build.js` says of `staleProcessWarning()`:
//
//   > A stale process makes EVERY answer potentially wrong, so this does not belong only in
//   > graph_health — a reader who never calls health would never learn.
//
// That is the intent. The effect, measured by asking who imports it, was ONE consumer:
// `query/verbs/read_freshness.js`. Every other verb returned answers from old code and said
// nothing. Three of the field test's last four rounds opened blocked on a stale process, and they
// asked for this three times.
//
// ⚠ THIS IS THE FAILURE MODE THE COMMENT ITSELF WARNS ABOUT, one level up: a comment describing
// what a function is FOR, read as a description of where it is USED. Nothing was lying; the
// wiring simply never happened, and no test could notice because every test called the function
// directly.
//
// ⇒ So this file does not call the function. It spawns the REAL server, sends a REAL tools/call,
// and reads the response an agent would actually receive.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = 'tests/fixtures/integration/sample-project';
let repo;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'apg-stalewire-'));
  await cp(FIXTURE, repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
}, 120_000);

afterAll(async () => {
  if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } }
});

function rpc(messages, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['mcp/stdio/server.js'], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.end();
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(`server exited ${code}: ${stderr}`)); return; }
      resolve(stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    });
  });
}

// One verb call against the fixture repo. `APG_TEST_FORCE_LOADED_COMMIT` makes the process claim
// it loaded an older commit than the checkout holds — the seam is one-directional, so it can
// manufacture staleness and can never conceal it.
async function callVerb(name, args, { stale }) {
  const lines = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { repo, ...args } } },
  ], stale ? { APG_TEST_FORCE_LOADED_COMMIT: '0000dead' } : {});
  return lines.find((l) => l.id === 2)?.result?.content?.[0]?.text ?? '';
}

const STALE_MARKER = /SERVER IS RUNNING STALE CODE/;

describe('a stale process warns through EVERY verb, not just the two that imported it', () => {
  // ⚠ TWO VERBS, CHOSEN FOR THE BRANCH THEY EXERCISE — not for coverage theatre. The notice
  // channel formats a STRING result and an OBJECT result along different paths (`WARNING:` prefix
  // vs a `_warnings` key). A wiring that reached only one of those would be half-wired, and one
  // representative verb could not tell the difference.
  it('★★★ reaches graph_health ON A REPO WITH NO GRAPH — where it used to go silent', async () => {
    // ⛔ I ORIGINALLY EXEMPTED graph_health, reasoning that it carries the full serverBuild block
    // already. This test caught that the reasoning is false: with no graph, health returns early
    // with `{indexed:false, trust:"missing", summary:"No graph at …"}` and never reaches that
    // block. The one verb I excused was therefore silent about stale code in exactly the
    // situation where someone is diagnosing — an unindexed repo, on a process that may be
    // running code from before the indexer was fixed.
    //
    // The fixture repo here is deliberately NOT indexed, so this exercises that path.
    const text = await callVerb('graph_health', {}, { stale: true });
    expect(text, 'the no-graph early return must not swallow build staleness').toMatch(STALE_MARKER);
  }, 180_000);

  it('★★★ reaches graph_search, which imported nothing and previously said nothing', async () => {
    const text = await callVerb('graph_search', { query: 'main' }, { stale: true });
    expect(text, 'this is the verb an agent opens a round with').toMatch(STALE_MARKER);
  }, 180_000);

  it('★★★ reaches a STRING-returning verb, the other branch of the notice channel', async () => {
    const text = await callVerb('graph_packet', { target: 'main', mode: 'orient' }, { stale: true });
    expect(text).toMatch(STALE_MARKER);
  }, 180_000);

  it('★★★ NEGATIVE CONTROL — a current process says nothing, so the warning means something', async () => {
    // ⚠ Without this the wiring could unconditionally emit the sentence and every test above
    // would still pass. A warning that is always present is not a warning, it is a banner, and
    // readers learn to skip it — which is precisely how the graph-staleness line got treated.
    const text = await callVerb('graph_search', { query: 'main' }, { stale: false });
    expect(text, 'a healthy process must be silent here').not.toMatch(STALE_MARKER);
  }, 180_000);

  it('★★★ the PROCESS warning is ordered ABOVE the graph-staleness warning', async () => {
    // ⛔ A MUTATION BATTERY CAUGHT THIS AS AN UNTESTED CLAIM. The code comment says the process
    // warning goes first "because it invalidates the reading of everything under it", and moving
    // it to last left every test green — so the ordering was an assertion in prose only, which is
    // the exact species of claim this project keeps having to retract.
    //
    // The two staleness facts are independent, and this is the case where BOTH are true: the
    // graph is indexed at an older commit AND the process loaded older code. A reader who takes
    // the graph-freshness line first will go run graph_index, get a fresh graph, and still be
    // talking to old code — fixing the cheaper problem and concluding they are done.
    // ⚠ ITS OWN REPO. The shared fixture is deliberately UNINDEXED so the health case above can
    // exercise the no-graph early return; indexing it here would make that test depend on
    // execution order, which is a coupling nobody would see until it broke.
    const indexed = await mkdtemp(join(tmpdir(), 'apg-stalewire-idx-'));
    try {
      await cp(FIXTURE, indexed, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: indexed });
      execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: indexed });
      execFileSync('git', ['config', 'user.name', 'test'], { cwd: indexed });
      execFileSync('git', ['add', '.'], { cwd: indexed });
      execFileSync('git', ['commit', '-qm', 'init'], { cwd: indexed });

      const { ensureFresh } = await import('../../mcp/stdio/freshness/orchestrator.js');
      await ensureFresh({ repoRoot: indexed });
      // Move HEAD past the indexed commit so the GRAPH is stale too.
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'move HEAD past the index'], { cwd: indexed });

      const lines = await rpc([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_search', arguments: { repo: indexed, query: 'main' } } },
      ], { APG_TEST_FORCE_LOADED_COMMIT: '0000dead' });
      const text = lines.find((l) => l.id === 2)?.result?.content?.[0]?.text ?? '';
      const processAt = text.search(STALE_MARKER);
      const graphAt = text.search(/graph stale: indexed at/);
      expect(processAt, 'process warning must be present').toBeGreaterThan(-1);
      expect(graphAt, 'graph warning must be present — otherwise this proves nothing about order')
        .toBeGreaterThan(-1);
      expect(processAt, 'the code fact outranks the data fact').toBeLessThan(graphAt);
    } finally {
      try { await rm(indexed, { recursive: true, force: true }); } catch { /* win lock */ }
    }
  }, 300_000);

  it('★★★ the warning states the process scope, not the repo scope', async () => {
    // the field test reasoned "echoes has not moved, so I can test there" and was wrong: one process
    // serves both repos. The sentence has to close that inference at the point of use.
    const text = await callVerb('graph_search', { query: 'main' }, { stale: true });
    expect(text).toMatch(/EVERY REPO THIS PROCESS SERVES/);
  }, 180_000);
});
