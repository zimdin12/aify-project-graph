// THE BARE-SYMBOL PATH WAS NON-FUNCTIONAL ON REAL C++ REPOS.
//
// Measured (ef-manager, echoes, 2026-08-10): ALL THREE symbols tried —
// SimCoordinator, WorldBuffer, GpuMaterial — blew graph_packet's 2000ms
// symbol→feature budget. Not an edge case. On a 12,126-node C++ repo the
// flagship orientation verb could not resolve ANY bare symbol.
//
//   graphConsequences round-trip: 601ms @ 3,958 nodes · 4316ms @ 12,126 nodes
//
// The earlier fix made the timeout HONEST (it stopped reporting a latency fact as
// "symbol not found"). This one makes the path WORK: mapping a symbol to its
// feature does not need callers, importers, documents_mentioning, tasks, tests,
// git history, risk flags or a receipt — all of which graphConsequences computes.
// It needs the label resolved and the anchors checked.
//
// Deliberately NOT fixed by raising the budget: a bigger number moves the cliff
// and still leaves the reader unable to tell which side they are on.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.
//
// The previous version had four cases and all four read packet.js as text: three took a
// fixed-width slice after `indexOf('function resolveFeatureForSymbolCheap')` (2200 chars,
// then 2400 for the fourth), and one compared two `indexOf` offsets to assert call order.
// Grow the resolver past the slice width and cases go green having checked nothing.
//
// The real property is stronger than any of them and needs no source reading: make the
// expensive verb NEVER RETURN, then require the packet to answer anyway. If the cheap
// resolver is missing, dead, ordered after the budgeted call, or silently broken, the
// packet lands in the timeout branch and this file goes red. One behavioural assertion
// subsumes cases 1 and 2 — the resolver exists AND runs first AND actually works.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// The budgeted path, made infinitely expensive. This is the echoes condition taken to its
// limit: any packet that depends on graphConsequences to map symbol→feature cannot finish.
vi.mock('../../../mcp/stdio/query/verbs/consequences.js', () => ({
  graphConsequences: () => new Promise(() => {}),
}));

const { graphPacket } = await import('../../../mcp/stdio/query/verbs/packet.js');

let repoRoot;

// `anchors` is passed through verbatim so each test can state the anchor shape it means
// to exercise — a symbol list, or a file glob.
async function makeRepo(anchors, { breakDb = false } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-cheap-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  await writeFile(join(repo, '.aify-graph', 'functionality.json'), JSON.stringify({
    features: [{ id: 'sim-core', name: 'sim-core', anchors }],
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('sc', 'Class', 'SimCoordinator', 'game/sim/coordinator.cpp', 88, 140, 'cpp', 1, '{}')`,
  );
  db.close();
  if (breakDb) {
    // Not deleted — deletion is a path the resolver can check for. A file that IS there
    // and is NOT a database is the case that throws from inside, which is what the
    // fall-through exists to absorb.
    await writeFile(join(repo, '.aify-graph', 'graph.sqlite'), 'not a database at all');
  }
  return repo;
}

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('graph_packet resolves symbol→feature without the full traversal', () => {
  it('★★ answers a bare symbol even when the expensive verb NEVER returns', async () => {
    // Cases 1 and 2 of the old file, as one property. Resolver missing, dead, ordered
    // after the budgeted call, or broken → the packet times out and this goes red.
    repoRoot = await makeRepo({ symbols: ['SimCoordinator'], files: [] });
    const text = asText(await graphPacket({ repoRoot, target: 'SimCoordinator' }));

    expect(text, 'the feature must resolve without the traversal').toMatch(/sim-core/);
    expect(text, 'reaching the timeout branch means the cheap path did not run or did not work')
      .not.toMatch(/TIMED OUT/);
  }, 20_000);

  it('★★ matches file-glob anchors the same way consequences does', async () => {
    // Two matching rules for one question is the defect class this codebase keeps
    // finding in itself. The old test asserted the GLOB EXPRESSION was present in the
    // source; this asserts a glob anchor actually resolves — with no symbol anchor at
    // all, so only the file rule can produce the match.
    repoRoot = await makeRepo({ symbols: [], files: ['game/sim/*'] });
    const text = asText(await graphPacket({ repoRoot, target: 'SimCoordinator' }));

    expect(text, 'a trailing-* file anchor must match by prefix').toMatch(/sim-core/);
    expect(text).not.toMatch(/TIMED OUT/);
  }, 20_000);

  it('★ an exact (non-glob) file anchor matches only the exact path', async () => {
    // The other half of the shared rule. If the glob branch were applied to every
    // pattern, this prefix-of-nothing anchor would wrongly match.
    //
    // ⛔ NON-EXECUTION USED TO SATISFY THIS. graph-senior-dev-hermes made the exact-anchor
    // comparison THROW: the cheap resolver fell through to the expensive traversal, which
    // is mocked to never return, the packet landed in the timeout branch — and the case
    // still passed, because "sim-core is absent" is trivially true of an output that
    // reports nothing at all. A negative assertion cannot tell "we looked and it was not
    // there" from "we never got as far as looking".
    //
    // ⇒ SAME-CALL LIVENESS FIRST. The resolver must be shown to have RUN and produced its
    // known-symbol answer before absence means anything.
    repoRoot = await makeRepo({ symbols: [], files: ['game/sim'] });
    const text = asText(await graphPacket({ repoRoot, target: 'SimCoordinator' }));

    expect(text, 'LIVENESS: the cheap resolver must have run — a timeout proves nothing here')
      .not.toMatch(/TIMED OUT/);
    expect(text, 'LIVENESS: and it must have resolved the symbol, not merely failed quietly')
      .toMatch(/SimCoordinator/);
    expect(text, 'LIVENESS: reaching the symbol-pointer path is what "known but unmapped" looks like')
      .toMatch(/game\/sim\/coordinator\.cpp/);

    // Only now is the absence evidence.
    expect(text, 'an exact anchor is not a prefix anchor').not.toMatch(/sim-core/);
  }, 20_000);

  it('★ a broken database degrades orientation, it does not fail it', async () => {
    // The fall-through, asserted as behaviour. The old case matched `catch { return null`
    // in the source — which is true of a catch that rethrows two lines later.
    repoRoot = await makeRepo({ symbols: ['SimCoordinator'], files: [] }, { breakDb: true });

    const call = graphPacket({ repoRoot, target: 'SimCoordinator' });
    await expect(call, 'orientation must never throw on a corrupt index').resolves.toBeDefined();
  }, 20_000);
});
