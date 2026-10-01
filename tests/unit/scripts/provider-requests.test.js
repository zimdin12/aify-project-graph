// ⛔⛔ A QUEUED CALL IS ANSWERED WITH WHO SAW WHAT, OR REFUSED WITH WHY. NEVER LEFT TO EXPIRE, NEVER A BARE EMPTY.
//
// The dashboard's request queue (aify-dashboard 36b6217): PROVIDER_CALLS = resolve, stamp, subgraph. Shapes agreed
// with dashboard-manager on 2026-10-01:
//   stamp    args {anchors: [anchor]} -> {stamps: [{anchor, stamp: {hash, stampVersion, commit}} | {anchor, refused, reason}]}
//   resolve  args {anchors: [anchor]} -> {results: [{anchor, status: found|gone|ambiguous|unwatched, candidates?, reasonCode?}]}
//   subgraph not supported yet: ok false with that problem, until apg has a read-only mode
// Every ok answer carries provenance {providerCommit, exhaustive, provenance}, and the service refuses an ok answer
// without it (queue.ts provenanceFrom). exhaustive is false: a tree-sitter extraction is not a full build.
import { describe, it, expect } from 'vitest';
import { resolveAnchor, STAMP_VERSIONS } from '../../../scripts/lib/anchor-resolver.mjs';
import { answerRequest } from '../../../scripts/lib/provider-requests.mjs';

const HEAD = 'c'.repeat(40);
const COMPLETE = Object.freeze({ parseHadError: false, depthCapFired: false, depthCap: 80 });
const fn = (label, qname, line) => ({ type: 'Function', label, start_line: line, structural_fp: `S-${qname}`, dependency_fp: `D-${qname}`, extra: { qname } });
const FILES = { 'src/a.js': [fn('alpha', 'alpha', 1), fn('run', 'A.run', 5), fn('run', 'B.run', 9)] };
const deps = {
  languageOf: (rel) => { if (rel.endsWith('.js')) return { name: 'javascript' }; throw new Error('none'); },
  isDocument: () => false,
  readSource: (rel) => `source of ${rel}`,
  extract: ({ relPath }) => ({ nodes: [{ type: 'File', label: relPath }, ...(FILES[relPath] ?? [])], coverage: COMPLETE }),
  fileFingerprint: () => 'FILE-FP',
  docReferences: () => [],
  isPresent: (rel) => Object.hasOwn(FILES, rel),
  where: `commit ${HEAD.slice(0, 12)}`,
};
const resolveItem = (item) => resolveAnchor({ repoRoot: '/unused', item, deps });
const ask = (call, args) => answerRequest({ request: { call, args }, resolveItem, head: HEAD });
const anchor = (name, path = 'src/a.js', kind = 'symbol') => ({ path, name, kind });

describe('every ok answer says who saw what', () => {
  it('★★★ provenance names the commit, says it is NOT exhaustive, and says how', () => {
    const out = ask('stamp', { anchors: [anchor('alpha')] });
    expect(out.ok).toBe(true);
    expect(out.provenance).toEqual({ providerCommit: HEAD, exhaustive: false, provenance: expect.stringMatching(/tree-sitter/u) });
  });
});

describe('stamp', () => {
  it('★★★ a stampable anchor gets {hash, stampVersion, commit}, and the commit is the head it was read at', () => {
    const { value } = ask('stamp', { anchors: [anchor('alpha')] });
    expect(value.stamps).toHaveLength(1);
    expect(value.stamps[0].anchor).toEqual(anchor('alpha'));
    expect(value.stamps[0].stamp).toEqual({ hash: expect.stringMatching(/^[0-9a-f]{64}$/u), stampVersion: STAMP_VERSIONS.symbol, commit: HEAD });
  });

  it('★★★ an anchor it cannot vouch for is REFUSED with its code and reason, one entry per anchor, in order', () => {
    const { value } = ask('stamp', { anchors: [anchor('gone', 'src/missing.js'), anchor('run'), anchor('alpha')] });
    expect(value.stamps.map((s) => s.refused ?? 'stamped')).toEqual(['gone', 'ambiguous_anchor', 'stamped']);
    expect(value.stamps[0].reason).toMatch(/not present in commit/u);
    expect(value.stamps[1].reason.length).toBeGreaterThan(0);
  });
});

describe('resolve', () => {
  it('★★★ found, gone, ambiguous with candidates, and unwatched with its code', () => {
    const { value } = ask('resolve', { anchors: [
      anchor('alpha'), anchor('x', 'src/missing.js'), anchor('run'), anchor('x', 'src/a.js', 'paragraph'),
    ] });
    expect(value.results).toEqual([
      { anchor: anchor('alpha'), status: 'found' },
      { anchor: anchor('x', 'src/missing.js'), status: 'gone' },
      { anchor: anchor('run'), status: 'ambiguous', candidates: [
        { name: 'run', qname: 'A.run', line: 5 }, { name: 'run', qname: 'B.run', line: 9 },
      ] },
      { anchor: anchor('x', 'src/a.js', 'paragraph'), status: 'unwatched', reasonCode: 'unsupported_anchor_kind' },
    ]);
  });

  it('★★★ CONTROL: a symbol that is simply not in the file is gone, not ambiguous and not unwatched', () => {
    expect(ask('resolve', { anchors: [anchor('nothere')] }).value.results[0].status).toBe('gone');
  });
});

describe('what is refused outright, with the reason', () => {
  it('★★★ subgraph is not supported yet, and says so', () => {
    const out = ask('subgraph', { query: {} });
    expect(out.ok).toBe(false);
    expect(out.problem).toBe('subgraph is not supported by this provider yet');
  });

  it('★★★ a call this provider does not know, including the retired `signals`, is refused by name', () => {
    for (const call of ['signals', 'drop_tables', '']) {
      const out = ask(call, { anchors: [anchor('alpha')] });
      expect(out.ok, call).toBe(false);
      expect(out.problem, call).toMatch(/not a call this provider answers/u);
    }
  });

  it('★★★ malformed args are refused, and an empty question is not answered with an empty answer', () => {
    for (const args of [null, {}, { anchors: 'alpha' }, { anchors: [] }, { anchors: [null] }, { anchors: ['src/a.js'] }]) {
      const out = ask('stamp', args);
      expect(out.ok, JSON.stringify(args)).toBe(false);
      expect(out.problem, JSON.stringify(args)).toMatch(/anchors/u);
    }
  });
});
