// THE DELTA'S FOUNDATION: A "BEFORE" THAT DOES NOT EXIST YET.
//
// ⛔ WHY THIS IS NEEDED AT ALL, verified in the schema 2026-09-06. The graph database holds exactly
// ONE snapshot: `structural_fingerprints` is keyed `file_path PRIMARY KEY` and re-extracting a file
// REPLACES its row, and `graph_generation` is `CHECK (id = 1)`. So nothing retains history, and
// "how did the shape change between these two commits" cannot be answered from it.
//
// ⭐ AND THAT IS EXACTLY WHY `graph_explain_diff` WORKS WITHOUT HISTORY, which is the distinction
// this module exists to make. That verb takes a GIT diff and maps the changed FILES onto CURRENT
// symbols. It answers "what does this diff TOUCH". It never sees the previous graph, so it cannot
// answer "how did the shape CHANGE". Two adjacent questions, one noun apart — and collapsing them
// would be this repository's own recurring error.
//
// A digest holds only what a delta reads: per-symbol fan-in/fan-out, edges keyed src>dst, layer, and
// the file each symbol lives in. Not the graph. Appending a full snapshot per commit would grow
// without bound for a query that only needs aggregates.
import { describe, it, expect } from 'vitest';
import { buildDigest, computeDelta, DIGEST_VERSION, symbolKey } from '../../../mcp/stdio/storage/structural-digest.mjs';

// ⛔ A SYMBOL'S IDENTITY IS ITS NAME AND ITS FILE. Edges name that identity rather than a bare
// qname, because a qname alone merges every overload and same-named method into one symbol.
const FILES = { render: 'ui/render.js', load: 'data/load.js', parse: 'data/parse.js', log: 'util/log.js' };
const K = (qname) => symbolKey(qname, FILES[qname]);

// A tiny two-layer graph. `render` (ui) calls `load` (data); `load` calls `parse` (data).
const BASE = {
  commit: 'a'.repeat(40),
  extractorVersion: '0.5.0',
  symbols: [
    { qname: 'render', file: 'ui/render.js', layer: 'ui' },
    { qname: 'load', file: 'data/load.js', layer: 'data' },
    { qname: 'parse', file: 'data/parse.js', layer: 'data' },
  ],
  edges: [
    { from: K('render'), to: K('load'), relation: 'CALLS' },
    { from: K('load'), to: K('parse'), relation: 'CALLS' },
  ],
};

const digestOf = (over = {}) => buildDigest({ ...BASE, ...over });

describe('a structural digest is the before that the database does not keep', () => {
  it('★★★ is DETERMINISTIC — the same graph yields the same digest', () => {
    // Storage compares digests across runs. If input order changed the output, every delta would
    // report churn that never happened, and the drift signal would be noise.
    const shuffled = digestOf({
      symbols: [...BASE.symbols].reverse(),
      edges: [...BASE.edges].reverse(),
    });
    // ⛔ SERIALIZED, NOT toEqual. Mutation caught this: `toEqual` compares objects structurally and
    // IGNORES KEY ORDER, so it passed happily with the key sort removed. A digest is persisted and
    // compared as bytes, so byte-stability is the property that actually matters and the assertion
    // has to be made on the bytes.
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(digestOf()));
    expect(Object.keys(shuffled.symbols)).toEqual([K('load'), K('parse'), K('render')].sort());
    expect(digestOf().digestVersion).toBe(DIGEST_VERSION);
  });

  it('★★★ records fan-in and fan-out per symbol, which is what the drift signal reads', () => {
    const d = digestOf();
    expect(d.symbols[K('load')]).toMatchObject({ qname: 'load', file: 'data/load.js', layer: 'data', fanIn: 1, fanOut: 1 });
    expect(d.symbols[K('render')]).toMatchObject({ fanIn: 0, fanOut: 1 });
    expect(d.symbols[K('parse')]).toMatchObject({ fanIn: 1, fanOut: 0 });
  });

  it('★★ an edge naming a symbol the digest does not hold is refused, not silently counted', () => {
    // A dangling edge would inflate fan-in for a symbol nobody can look up, and the inflation would
    // then read as growth on the next delta.
    expect(() => digestOf({ edges: [{ from: K('render'), to: symbolKey('ghost', 'x.js'), relation: 'CALLS' }] })).toThrow(/ghost/);
  });
});

describe('computeDelta reports how the shape moved, and refuses when it cannot attribute movement', () => {
  it('★★★ THE LOAD-BEARING RULE: a delta across an EXTRACTOR VERSION boundary REFUSES', () => {
    // ⛔ A digest is only comparable to one produced by the same extractor. Change the extractor and
    // every number moves at once — a delta would report that as the CODE changing, which is the
    // extractor-version coupling that already made one shipped feature inert on every existing
    // graph. Designed against here rather than discovered later.
    const d = computeDelta(digestOf(), digestOf({ extractorVersion: '0.6.0' }));
    expect(d.comparable).toBe(false);
    expect(d.refusal).toMatch(/extractor/i);
    // ⛔ AND IT MUST NOT ALSO REPORT MOVEMENT. A refusal that still hands back numbers invites a
    // reader to use them anyway.
    expect(d.fanInMoved).toEqual([]);
    expect(d.edgesAdded).toEqual([]);
  });

  it('★★★ THE POSITIVE CONTROL: a digest against ITSELF reports no movement at all', () => {
    // Without this, every assertion below could pass on a delta that always reports churn.
    const d = computeDelta(digestOf(), digestOf());
    expect(d.comparable).toBe(true);
    expect(d.symbolsAdded).toEqual([]);
    expect(d.symbolsRemoved).toEqual([]);
    expect(d.edgesAdded).toEqual([]);
    expect(d.edgesRemoved).toEqual([]);
    expect(d.fanInMoved).toEqual([]);
    expect(d.newCrossLayerEdges).toEqual([]);
  });

  it('★★★ FAN-IN MOVEMENT CARRIES DIRECTION, because the level alone means nothing', () => {
    // A snapshot cannot tell you whether fan-in 200 is bad; it might be a logger. "12 to 200 in
    // three weeks" is the information nothing else has — including a human reviewer, who also only
    // sees the snapshot inside the diff.
    const after = digestOf({
      symbols: [...BASE.symbols, { qname: 'log', file: 'util/log.js', layer: 'util' }],
      edges: [...BASE.edges, { from: K('render'), to: K('log'), relation: 'CALLS' }, { from: K('load'), to: K('log'), relation: 'CALLS' }],
    });
    const d = computeDelta(digestOf(), after);
    expect(d.symbolsAdded).toEqual([{ qname: 'log', file: 'util/log.js' }]);
    const moved = d.fanInMoved.find((m) => m.qname === 'log');
    expect(moved).toMatchObject({ from: 0, to: 2, delta: 2, direction: 'grew' });

    // ⛔ BOTH DIRECTIONS, OR THE FIELD IS UNTESTED. Mutation caught this: hardcoding
    // `direction: 'grew'` survived, because every case here grew. A shrinking fan-in is also the
    // more interesting signal — something stopped depending on this.
    const shrunk = computeDelta(after, digestOf());
    const lost = shrunk.fanInMoved.find((m) => m.qname === 'log');
    expect(lost).toMatchObject({ from: 2, to: 0, delta: -2, direction: 'shrank' });
  });

  it('★★★ A NEW CROSS-LAYER EDGE IS THE SHAPE SIGNAL — it has no local error signal today', () => {
    // This is the whole point of the delta: a shape decision fails months later, in someone else's
    // task, and nobody attributes it back. Surfacing it at the moment of the change is the only
    // intervention that touches the cause.
    const after = digestOf({ edges: [...BASE.edges, { from: K('parse'), to: K('render'), relation: 'CALLS' }] });
    const d = computeDelta(digestOf(), after);
    expect(d.newCrossLayerEdges).toEqual([{ from: K('parse'), to: K('render'), fromLayer: 'data', toLayer: 'ui' }]);
    // A new edge WITHIN one layer is movement but not a layer crossing, and must not be reported as
    // one — a signal that fires on everything is decoration.
    const sameLayer = computeDelta(digestOf(), digestOf({ edges: [...BASE.edges, { from: K('parse'), to: K('load'), relation: 'CALLS' }] }));
    expect(sameLayer.edgesAdded).toHaveLength(1);
    expect(sameLayer.newCrossLayerEdges).toEqual([]);
  });

  it('★★ a removed symbol and its edges are both reported', () => {
    const after = digestOf({
      symbols: BASE.symbols.filter((s) => s.qname !== 'parse'),
      edges: BASE.edges.filter((e) => e.to !== K('parse')),
    });
    const d = computeDelta(digestOf(), after);
    expect(d.symbolsRemoved).toEqual([{ qname: 'parse', file: 'data/parse.js' }]);
    expect(d.edgesRemoved).toHaveLength(1);
    // The key carries both identities and the relation; asserting its spelling would make this a
    // format check rather than a behaviour one.
    expect(d.edgesRemoved[0]).toContain('parse');
  });
});
