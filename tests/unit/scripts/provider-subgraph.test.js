// ⛔⛔ THE SUBGRAPH ANSWER IS A PICTURE OF THE INDEX AS IT STANDS: READ-ONLY, ATTESTED, AND HONEST ABOUT ITS AGE.
//
// Shape agreed with dashboard-manager on 2026-10-17 (scripts/lib/provider-subgraph.mjs). What these tests hold:
//   · args are refused when wrong, never defaulted over;
//   · every edge says how its target was decided (compiler | name | structural | ambiguous | unknown);
//   · the walk is breadth-first with ties by id, so a cut is the same cut every time, and `matched` counts past it;
//   · External nodes are left out unless asked for, and counted when they are;
//   · every anchor the answer emits is one the provider's own `resolve` finds, which is what pinning needs;
//   · reading writes NOTHING and never rebuilds: a commit after the index leaves the index as it was and says stale.
//
// The integration half runs the real indexer over a scratch repository, not a hand-built database, so the edges
// these assertions meet are the ones the extractor actually writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { resolveAnchor } from '../../../scripts/lib/anchor-resolver.mjs';
import { makeInstruments } from '../../../scripts/lib/provider-runtime.mjs';
import {
  parseSubgraphArgs, readSubgraph, resolutionOf, KNOWN_PROVENANCES, SUBGRAPH_BOUNDS,
} from '../../../scripts/lib/provider-subgraph.mjs';

describe('arguments', () => {
  it('★★★ defaults are applied only to what was not sent', () => {
    expect(parseSubgraphArgs({ path: 'src/a.js' })).toEqual({
      ok: true, value: { start: { path: 'src/a.js' }, depth: 1, limit: 200, edgeKinds: null, includeExternal: false },
    });
    expect(parseSubgraphArgs({ anchor: { kind: 'symbol', path: 'p', name: 'n' }, depth: 3, limit: 1000, edgeKinds: ['CALLS', 'CALLS'], includeExternal: true }).value)
      .toEqual({ start: { anchor: { kind: 'symbol', path: 'p', name: 'n' } }, depth: 3, limit: 1000, edgeKinds: ['CALLS'], includeExternal: true });
  });

  it('★★★ anything sent wrong is refused, with what was wrong', () => {
    const cases = [
      [null, /args must be an object/u],
      [{}, /exactly one of args.anchor or args.path/u],
      [{ path: 'a', anchor: {} }, /exactly one/u],
      [{ anchor: 'src/a.js' }, /anchor must be an anchor object/u],
      [{ path: '  ' }, /path must be a non-empty string/u],
      [{ path: 'a', depth: 0 }, /depth must be an integer from 1 to 3/u],
      [{ path: 'a', depth: SUBGRAPH_BOUNDS.depth.max + 1 }, /depth/u],
      [{ path: 'a', depth: 1.5 }, /depth/u],
      [{ path: 'a', limit: SUBGRAPH_BOUNDS.limit.max + 1 }, /limit must be an integer from 1 to 1000/u],
      [{ path: 'a', edgeKinds: [] }, /edgeKinds/u],
      [{ path: 'a', edgeKinds: ['CALLS', 3] }, /edgeKinds/u],
      [{ path: 'a', includeExternal: 'yes' }, /includeExternal/u],
    ];
    for (const [args, problem] of cases) {
      const out = parseSubgraphArgs(args);
      expect(out.ok, JSON.stringify(args)).toBe(false);
      expect(out.problem, JSON.stringify(args)).toMatch(problem);
    }
  });
});

describe('resolution: how an edge\'s target was decided', () => {
  it('★★★ every provenance the storage ladder declares has a bucket, so a new one cannot fall into `name` unseen', () => {
    expect(KNOWN_PROVENANCES.length, 'the ladder must be read, or this loop proves nothing').toBeGreaterThan(0);
    for (const provenance of KNOWN_PROVENANCES) {
      expect(resolutionOf({ relation: 'CALLS', provenance }), provenance).not.toBe('unknown');
    }
  });

  it('★★★ compiler facts, name matches, containment and ambiguity are told apart; an unknown provenance says so', () => {
    expect(resolutionOf({ relation: 'CALLS', provenance: 'LSP_VERIFIED' })).toBe('compiler');
    expect(resolutionOf({ relation: 'CALLS', provenance: 'CODE_INTEL' })).toBe('compiler');
    expect(resolutionOf({ relation: 'CALLS', provenance: 'EXTRACTED' })).toBe('name');
    expect(resolutionOf({ relation: 'IMPORTS', provenance: 'EXTRACTED' }), 'a path match can be wrong').toBe('name');
    expect(resolutionOf({ relation: 'CONTAINS', provenance: 'EXTRACTED' })).toBe('structural');
    expect(resolutionOf({ relation: 'DEFINES', provenance: 'EXTRACTED' })).toBe('structural');
    expect(resolutionOf({ relation: 'CALLS', provenance: 'AMBIGUOUS' })).toBe('ambiguous');
    expect(resolutionOf({ relation: 'CALLS', provenance: 'CODE_INTEL_REPLAY' })).toBe('unknown');
    expect(resolutionOf({ relation: 'CALLS', provenance: null })).toBe('unknown');
  });
});

describe('reading a real index', () => {
  let repoRoot;
  let head;
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  const commitAll = () => {
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
    return git('rev-parse', 'HEAD');
  };
  const ask = (args) => {
    const parsed = parseSubgraphArgs(args);
    expect(parsed.ok, parsed.problem).toBe(true);
    return readSubgraph({ repoRoot, request: parsed.value, head });
  };
  const byName = (answer, name) => answer.value.nodes.find((n) => n.name === name);
  const fileBytes = async () => {
    const out = {};
    for (const f of ['graph.sqlite', 'graph.sqlite-wal', 'manifest.json']) {
      try { out[f] = createHash('sha256').update(await readFile(join(repoRoot, '.aify-graph', f))).digest('hex'); } catch { out[f] = 'absent'; }
    }
    return out;
  };

  beforeAll(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-subgraph-'));
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    git('init', '-q');
    await writeFile(join(repoRoot, '.gitignore'), '.aify-graph/\n');
    await writeFile(join(repoRoot, 'src', 'target.js'), 'export function target() { return 1; }\n');
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { target } from './target.js';\nexport function caller() { return JSON.stringify(target()); }\n");
    await writeFile(join(repoRoot, 'src', 'twins.js'),
      'export class Left { run() { return 1; } }\nexport class Right { run() { return 2; } }\n');
    await writeFile(join(repoRoot, 'src', 'hub.js'), 'export function hub() { return 0; }\n');
    for (const n of ['c1', 'c2', 'c3', 'c4']) {
      await writeFile(join(repoRoot, 'src', `${n}.js`), `import { hub } from './hub.js';\nexport function ${n}() { return hub(); }\n`);
    }
    head = commitAll();
    await ensureFresh({ repoRoot });
  }, 120_000);

  afterAll(async () => {
    if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* win lock */ } }
  });

  it('★★★ from a symbol: the call it makes is there, typed and resolved by name, and the index names its commit', () => {
    const out = ask({ anchor: { kind: 'symbol', path: 'src/a.js', name: 'caller' } });
    expect(out.ok, out.problem).toBe(true);
    expect(out.value).toMatchObject({ indexCommit: head, head, stale: false, staleBecause: [], truncated: false });
    const caller = byName(out, 'caller');
    const target = byName(out, 'target');
    expect(caller, 'the start node is in the answer').toBeDefined();
    expect(target, 'the callee is one hop away').toBeDefined();
    expect(out.value.edges).toContainEqual({ from: caller.id, to: target.id, type: 'CALLS', resolution: 'name', provenance: 'EXTRACTED' });
    expect(target).toMatchObject({ kind: 'Function', path: 'src/target.js', lineRange: [1, 1] });
  });

  it('★★★ External nodes are left out and COUNTED; asked for, they appear, unpinnable', () => {
    const without = ask({ anchor: { kind: 'symbol', path: 'src/a.js', name: 'caller' } });
    const withExt = ask({ anchor: { kind: 'symbol', path: 'src/a.js', name: 'caller' }, includeExternal: true });
    const externals = withExt.value.nodes.filter((n) => n.kind === 'External');
    // CONTROL FIRST: the fixture must reach an External (JSON.stringify), or a zero below is the fixture's silence.
    expect(externals.length).toBeGreaterThan(0);
    expect(without.value.nodes.filter((n) => n.kind === 'External')).toEqual([]);
    expect(without.value.matched.dropped.external).toBe(externals.length);
    expect(withExt.value.matched.dropped.external).toBe(0);
    for (const n of externals) expect(n).toMatchObject({ path: null, anchor: null });
  });

  it('★★★ a cut is breadth-first with ties by id, the same every time, and matched counts past it', () => {
    const args = { anchor: { kind: 'symbol', path: 'src/hub.js', name: 'hub' }, limit: 3 };
    const full = ask({ ...args, limit: 1000 });
    const cut = ask(args);
    expect(full.value.matched.nodes, 'the hub must have more neighbours than the limit').toBeGreaterThan(3);
    expect(cut.value.truncated).toBe(true);
    expect(cut.value.nodes).toHaveLength(3);
    expect(cut.value.matched).toEqual(full.value.matched);
    const hub = byName(full, 'hub');
    const firstHop = full.value.nodes.filter((n) => n.id !== hub.id).map((n) => n.id).sort();
    expect(cut.value.nodes.map((n) => n.id)).toEqual([hub.id, ...firstHop.slice(0, 2)]);
    expect(ask(args)).toEqual(cut);
    // Every edge in a cut answer joins two nodes that are in it.
    const kept = new Set(cut.value.nodes.map((n) => n.id));
    for (const e of cut.value.edges) expect(kept.has(e.from) && kept.has(e.to), JSON.stringify(e)).toBe(true);
  });

  it('★★★ depth and edgeKinds narrow the walk', () => {
    const one = ask({ path: 'src/hub.js', depth: 1 });
    const three = ask({ path: 'src/hub.js', depth: 3 });
    expect(three.value.matched.nodes).toBeGreaterThan(one.value.matched.nodes);
    const callsOnly = ask({ anchor: { kind: 'symbol', path: 'src/hub.js', name: 'hub' }, edgeKinds: ['CALLS'] });
    expect(callsOnly.value.edges.length).toBeGreaterThan(0);
    expect(new Set(callsOnly.value.edges.map((e) => e.type))).toEqual(new Set(['CALLS']));
  });

  it('★★★ an ambiguous anchor is refused WITH its candidates in the text; by qname it is answered', () => {
    const out = ask({ anchor: { kind: 'symbol', path: 'src/twins.js', name: 'run' } });
    expect(out).toMatchObject({ ok: false, reasonCode: 'ambiguous_anchor' });
    expect(out.candidates).toHaveLength(2);
    const qnames = out.candidates.map((c) => c.qname);
    expect(new Set(qnames).size, 'two different symbols, not one listed twice').toBe(2);
    for (const q of qnames) expect(q).toMatch(/(Left|Right)\.run$/u);
    for (const c of out.candidates) expect(out.problem).toContain(c.qname);
    const one = ask({ anchor: { kind: 'symbol', path: 'src/twins.js', name: out.candidates[0].qname } });
    expect(one.ok, one.problem).toBe(true);
  });

  it('★★★ EVERY anchor the answer emits is one the provider\'s own resolve finds, so a drawn node can be pinned', () => {
    const deps = makeInstruments(repoRoot, { at: head });
    const answers = [
      ask({ path: 'src/twins.js', depth: 2 }),
      ask({ anchor: { kind: 'symbol', path: 'src/a.js', name: 'caller' }, depth: 2 }),
    ];
    const anchors = answers.flatMap((a) => a.value.nodes.map((n) => n.anchor)).filter(Boolean);
    // The population, printed by count: both kinds must be present, and the twins' shared label must be among them.
    expect(anchors.filter((a) => a.kind === 'symbol').length).toBeGreaterThan(2);
    expect(anchors.filter((a) => a.kind === 'file').length).toBeGreaterThan(0);
    expect(anchors.filter((a) => a.kind === 'symbol' && a.path === 'src/twins.js' && a.name.endsWith('run')).length).toBe(2);
    for (const anchor of anchors) {
      const verdict = resolveAnchor({ repoRoot, item: { watchId: 'w', anchor, stamp: null }, deps });
      expect(verdict.kind, JSON.stringify(anchor)).not.toBe('unwatched');
      expect(verdict.row.status, JSON.stringify(anchor)).not.toBe('gone');
    }
  });

  it('★★★ a path or symbol the index does not hold is refused as such', () => {
    expect(ask({ path: 'src/nothere.js' })).toMatchObject({ ok: false, reasonCode: 'not_in_index' });
    expect(ask({ anchor: { kind: 'symbol', path: 'src/a.js', name: 'nothere' } })).toMatchObject({ ok: false, reasonCode: 'not_in_index' });
    expect(ask({ anchor: { kind: 'paragraph', path: 'src/a.js' } }).problem).toMatch(/not file, module or symbol/u);
  });

  it('★★★ an index whose publication does not attest is refused, not served', async () => {
    const manifestPath = join(repoRoot, '.aify-graph', 'manifest.json');
    const original = await readFile(manifestPath, 'utf8');
    try {
      await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(original), generation: 999_999 }));
      expect(ask({ path: 'src/a.js' })).toMatchObject({ ok: false, reasonCode: 'index_not_attested' });
    } finally {
      await writeFile(manifestPath, original);
    }
    expect(ask({ path: 'src/a.js' }).ok, 'CONTROL: the restored manifest attests again').toBe(true);
  });

  // ⛔ LAST, because it commits: the head moves under the index.
  it('★★★ READ-ONLY: after a new commit the index is untouched, the new file absent, and the answer says stale', async () => {
    const before = await fileBytes();
    expect(before['graph.sqlite']).not.toBe('absent');
    await writeFile(join(repoRoot, 'src', 'later.js'), 'export function later() { return 2; }\n');
    const indexed = head;
    head = commitAll();
    const out = ask({ path: 'src/a.js' });
    expect(out.value).toMatchObject({ indexCommit: indexed, head, stale: true, staleBecause: ['index_behind_head'] });
    expect(ask({ path: 'src/later.js' }), 'a refresh would have indexed it').toMatchObject({ ok: false, reasonCode: 'not_in_index' });
    expect(await fileBytes()).toEqual(before);
  });

  it('★★★ no index at all is refused by name', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'apg-subgraph-none-'));
    try {
      const out = readSubgraph({ repoRoot: empty, request: parseSubgraphArgs({ path: 'a.js' }).value, head: 'h' });
      expect(out).toMatchObject({ ok: false, reasonCode: 'no_index' });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
