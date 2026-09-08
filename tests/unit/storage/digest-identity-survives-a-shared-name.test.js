// ⛔ THE DIGEST COLLAPSED TWO SYMBOLS INTO ONE AND ATTRIBUTED THE EDGES TO WHICHEVER CAME FIRST.
//
// `captureStructuralDigest` resolved every edge endpoint through node id to a QNAME, then reduced
// the symbol list to one entry per qname keeping the FIRST occurrence. Two distinct nodes that share
// a qname — the same method name in two files, an overload, a declaration and its definition — became
// one symbol carrying the FIRST file, and every edge aimed at the second was credited to it.
//
// Three separate errors fall out of that one identity choice:
//   1. the surviving symbol reports a file that is not where the edges point;
//   2. `SELECT from_id, to_id FROM edges` drops RELATION and PROVENANCE, so a CALLS and a
//      REFERENCES between the same pair are indistinguishable; and
//   3. `fanIn` counts every input edge while `edgeKeys` is deduplicated through a Set, so the two
//      numbers disagree by construction — 2 inbound edges, 1 edge key, on the same pair.
//
// ⭐ AND A FOURTH THAT NO REVIEW FOUND, BECAUSE NO FIXTURE HERE COULD CONTAIN IT. The edge key was
// `` `${from}>${to}` `` and the cross-layer reader did `key.split('>')`. This project targets C++,
// where a qname like `std::vector<int>::push_back` CONTAINS `>`, so that split takes the wrong
// halves for every templated symbol. Local JavaScript qnames have no `>` in them, which is exactly
// why every existing fixture agreed with the defect.
import { describe, it, expect } from 'vitest';
import { buildDigest, computeDelta, symbolKey } from '../../../mcp/stdio/storage/structural-digest.mjs';

const V = 'ext-1';
const digest = (commit, symbols, edges) => buildDigest({ commit, extractorVersion: V, symbols, edges });

// Two DIFFERENT symbols that share a qname, which is the shape the old key could not represent.
const TWINS = [
  { qname: 'Cache.get', file: 'src/a/cache.js', layer: null },
  { qname: 'Cache.get', file: 'src/b/cache.js', layer: null },
];
const A = symbolKey('Cache.get', 'src/a/cache.js');
const B = symbolKey('Cache.get', 'src/b/cache.js');

describe('a digest keeps two symbols that share a name apart', () => {
  it('★★★ THE REAL CASE: fan-in lands on the symbol the edge actually pointed at', () => {
    const caller = { qname: 'run', file: 'src/run.js', layer: null };
    const R = symbolKey('run', 'src/run.js');

    const before = digest('c1', [...TWINS, caller], []);
    // Both edges aim at the SECOND twin. Under the old identity both were credited to the first.
    const after = digest('c2', [...TWINS, caller], [
      { from: R, to: B, relation: 'CALLS' },
    ]);

    expect(after.symbols[B].fanIn, 'the symbol the edge points at gains the fan-in').toBe(1);
    expect(after.symbols[A].fanIn, 'its same-named twin gains nothing').toBe(0);
    expect(after.symbols[A].file).toBe('src/a/cache.js');
    expect(after.symbols[B].file).toBe('src/b/cache.js');

    const d = computeDelta(before, after);
    const moved = d.fanInMoved.filter((m) => m.qname === 'Cache.get');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ qname: 'Cache.get', file: 'src/b/cache.js', from: 0, to: 1 });
  });

  it('★★★ TWO RELATIONS BETWEEN ONE PAIR ARE TWO EDGES, so fan-in and edge count agree', () => {
    // The old key dropped the relation, so these two collapsed to one edgeKey while fanIn counted
    // both — a digest that disagreed with itself. Whichever number a reader trusted, one was wrong.
    const R = symbolKey('run', 'src/run.js');
    const d = digest('c1', [...TWINS, { qname: 'run', file: 'src/run.js', layer: null }], [
      { from: R, to: B, relation: 'CALLS' },
      { from: R, to: B, relation: 'REFERENCES' },
    ]);

    expect(d.symbols[B].fanIn).toBe(2);
    expect(d.edgeKeys).toHaveLength(2);
  });

  it('★★★ A TEMPLATED C++ QNAME SURVIVES THE EDGE KEY — the population this product targets', () => {
    // `std::vector<int>::push_back` contains the character the old key used as its separator. No
    // JavaScript fixture in this repository can reach this, which is why it shipped.
    const tmpl = { qname: 'std::vector<int>::push_back', file: 'src/v.hpp', layer: 'data' };
    const ui = { qname: 'Render::draw', file: 'src/ui.cpp', layer: 'ui' };
    const T = symbolKey(tmpl.qname, tmpl.file);
    const U = symbolKey(ui.qname, ui.file);

    const before = digest('c1', [tmpl, ui], []);
    const after = digest('c2', [tmpl, ui], [{ from: U, to: T, relation: 'CALLS' }]);
    const d = computeDelta(before, after);

    expect(d.edgesAdded).toHaveLength(1);
    // The crossing reader must recover BOTH endpoints from the key. Under `split('>')` the template
    // argument's own `>` truncated the name and the lookup missed, so no crossing could be seen.
    expect(d.crossLayer.available).toBe(true);
    expect(d.newCrossLayerEdges).toEqual([
      { from: U, to: T, fromLayer: 'ui', toLayer: 'data' },
    ]);
  });

  it('★★ THE POSITIVE CONTROL: a digest against itself still reports no movement', () => {
    // Without this, every assertion above is satisfied by a delta that reports churn constantly.
    const R = symbolKey('run', 'src/run.js');
    const d0 = digest('c1', [...TWINS, { qname: 'run', file: 'src/run.js', layer: null }], [
      { from: R, to: B, relation: 'CALLS' },
    ]);
    const d = computeDelta(d0, d0);

    expect(d.comparable).toBe(true);
    expect(d.symbolsAdded).toEqual([]);
    expect(d.symbolsRemoved).toEqual([]);
    expect(d.edgesAdded).toEqual([]);
    expect(d.fanInMoved).toEqual([]);
  });

  it('★★ A DANGLING EDGE IS STILL REFUSED, not silently counted', () => {
    // The existing contract, re-asserted because the identity change moves what "known" means: an
    // edge naming a symbol not in the digest must throw rather than inflate a fan-in nobody can
    // look up.
    expect(() => digest('c1', TWINS, [
      { from: symbolKey('ghost', 'src/ghost.js'), to: B, relation: 'CALLS' },
    ])).toThrow(/unknown source symbol/);
  });
});
