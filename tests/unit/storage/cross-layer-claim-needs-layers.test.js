// ⛔ THE CROSS-LAYER SIGNAL COULD NOT FIRE IN PRODUCTION, AND SAID SO AS "NONE FOUND".
//
// `captureStructuralDigest` takes `layerOf` and defaults it to `() => null`. At the pin 3a0e4b5c
// there was exactly ONE production call site (freshness/orchestrator.js:1089) and it passed no
// `layerOf` — so every symbol in every real digest carried `layer: null`. `computeDelta` then skips
// any pair with an unknown layer, which is the correct rule, and returned `newCrossLayerEdges: []`,
// which a reader and the dashboard both read as "we looked and there were none".
//
// ⭐ THE THREE DEAD-CODE SHAPES, AND THIS IS THE SECOND: a claim whose only witness is structurally
// excluded. The existing suite never saw it because every fixture in structural-digest.test.js
// carries layers ('data', 'ui', 'util'), so the probe's answer was FORCED by the fixture rather
// than earned. That is the same confound that made a 252/252 "positive control" meaningless.
//
// ⇒ A DEFENSIVE BRANCH SHOULD REFUSE, NOT GUESS. The question "did anything newly cross a layer
// boundary" is UNDECIDABLE without layers, and undecidable is not zero.
import { describe, it, expect } from 'vitest';
import { buildDigest, computeDelta, symbolKey } from '../../../mcp/stdio/storage/structural-digest.mjs';

const V = 'ext-1';
const FILES = { parse: 'data/parse.js', render: 'ui/render.js', load: 'data/load.js' };
const K = (q) => symbolKey(q, FILES[q]);

/** A digest shaped like a PRODUCTION one: real symbols, real edges, and no layer on anything. */
function unlabelled(edges) {
  return buildDigest({
    commit: 'c1',
    extractorVersion: V,
    symbols: [
      { qname: 'parse', file: 'data/parse.js', layer: null },
      { qname: 'render', file: 'ui/render.js', layer: null },
      { qname: 'load', file: 'data/load.js', layer: null },
    ],
    edges,
  });
}

/** The same shape WITH layers — the fixture the old tests used, kept here as the contrast. */
function labelled(edges) {
  return buildDigest({
    commit: 'c2',
    extractorVersion: V,
    symbols: [
      { qname: 'parse', file: 'data/parse.js', layer: 'data' },
      { qname: 'render', file: 'ui/render.js', layer: 'ui' },
      { qname: 'load', file: 'data/load.js', layer: 'data' },
    ],
    edges,
  });
}

describe('a cross-layer claim needs layers', () => {
  it('★★★ WITHOUT LAYERS THE QUESTION IS UNDECIDABLE, and must not be answered as zero', () => {
    // This is the production shape. An edge was genuinely added, and it may or may not cross a
    // boundary — nothing here can tell. Reporting an empty list asserts the stronger of the two.
    const d = computeDelta(unlabelled([]), unlabelled([{ from: K('parse'), to: K('render'), relation: 'CALLS' }]));

    expect(d.comparable).toBe(true);
    expect(d.edgesAdded).toHaveLength(1); // the edge IS seen — this is not a dead delta
    expect(d.crossLayer.available).toBe(false);
    expect(d.crossLayer.symbolsWithLayer).toBe(0);
    expect(d.crossLayer.symbolsTotal).toBe(3);
    expect(d.newCrossLayerEdges).toBeNull(); // ⛔ not [] — absence of an answer, not an answer of none
  });

  it('★★★ THE DISCRIMINATING CONTROL: with layers, a same-layer edge is a REAL zero', () => {
    // Without this the test above proves nothing: a function that always returned null would pass
    // it. This is the case where the instrument must SPEAK, and say none.
    const d = computeDelta(labelled([]), labelled([{ from: K('parse'), to: K('load'), relation: 'CALLS' }]));

    expect(d.crossLayer.available).toBe(true);
    expect(d.crossLayer.symbolsWithLayer).toBe(3);
    expect(d.newCrossLayerEdges).toEqual([]); // a genuine, earned zero
  });

  it('★★ THE POSITIVE CONTROL: with layers, a real crossing is still reported', () => {
    const d = computeDelta(labelled([]), labelled([{ from: K('parse'), to: K('render'), relation: 'CALLS' }]));

    expect(d.crossLayer.available).toBe(true);
    expect(d.newCrossLayerEdges).toEqual([
      { from: K('parse'), to: K('render'), fromLayer: 'data', toLayer: 'ui' },
    ]);
  });

  it('★★ a REFUSAL carries no cross-layer number either', () => {
    // The module already states the rule: "a refusal carries no numbers: a reader handed figures
    // alongside 'I cannot attribute this' uses them." An empty list is a figure.
    const d = computeDelta(
      buildDigest({ commit: 'a', extractorVersion: 'ext-1', symbols: [], edges: [] }),
      buildDigest({ commit: 'b', extractorVersion: 'ext-2', symbols: [], edges: [] }),
    );

    expect(d.comparable).toBe(false);
    expect(d.refusal).toBeTruthy();
    expect(d.newCrossLayerEdges).toBeNull();
    expect(d.crossLayer.available).toBe(false);
  });

  it('★ PARTIAL layer coverage is reported as partial, not as full knowledge', () => {
    // Half-labelled is the state a real overlay would produce. The count is what lets a reader see
    // that a zero was computed over three symbols and not thirty thousand.
    const before = buildDigest({
      commit: 'p1', extractorVersion: V,
      symbols: [
        { qname: 'parse', file: 'data/parse.js', layer: 'data' },
        { qname: 'render', file: 'ui/render.js', layer: null },
      ],
      edges: [],
    });
    const after = buildDigest({
      commit: 'p2', extractorVersion: V,
      symbols: [
        { qname: 'parse', file: 'data/parse.js', layer: 'data' },
        { qname: 'render', file: 'ui/render.js', layer: null },
      ],
      edges: [{ from: K('parse'), to: K('render'), relation: 'CALLS' }],
    });
    const d = computeDelta(before, after);

    expect(d.crossLayer.available).toBe(true);
    expect(d.crossLayer.symbolsWithLayer).toBe(1);
    expect(d.crossLayer.symbolsTotal).toBe(2);
    // The edge's target has no layer, so THIS edge stays undecided and is not claimed as a crossing.
    expect(d.newCrossLayerEdges).toEqual([]);
  });
});
