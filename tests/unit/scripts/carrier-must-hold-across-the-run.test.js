// ⛔⛔ THE GUARD REPORTED A BEHAVIOUR CHANGE ON A BYTE-IDENTICAL WORKING TREE.
//
// Observed 2026-08-21. `git status --porcelain` empty, `diff -q` confirming packet.js identical to
// its pre-run copy, no commit in between — and `refactor-guard.mjs --verify` printed:
//
//     BEHAVIOUR CHANGED on 7 of 61 corpus entries
//
// with NO refusal line. Three further runs on the same unchanged tree gave two REFUSALs and one
// PASS. **Three verdicts, one tree.**
//
// CAUSE. The old order was:
//
//     const now = carrier();               // sampled ONCE, before the work
//     const results = await runCorpus();   // 61 route executions, seconds of wall clock
//
// `APG_AUTO_REINDEX` self-heals the graph on MCP dispatch, so a reindex can land DURING the corpus
// run. The outputs then come from the new graph while the recorded carrier still matches the
// baseline — the drift check compares two stale samples, agrees, and the difference is attributed
// to the code.
//
// ⇒ **A false FAIL is worse than the refusal it replaced.** "REFUSED: cannot attribute" is honest.
// "BEHAVIOUR CHANGED on 7 of 61" is a specific accusation against code that did not change — the
// exact defect this script exists to prevent, occurring inside the script.
//
// ⇒ THE FIX IS THE REVIEW-LEASE PROTOCOL APPLIED TO AN INSTRUMENT. A reviewer binds a receipt by
// recording identity before a run, re-reading it after, and binding only if both ends match. One
// sample cannot detect movement during the window it certifies. **The second read is what makes
// the first one evidence.**
//
// ⚠ AND WHY THE PREDICATE MOVED OUT OF THE SCRIPT: `refactor-guard.mjs` calls `main()` at import,
// so importing it from a test would run the whole corpus and exit the process. A check that cannot
// be called cannot be tested — which is how this one stayed wrong. The source-order assertion at
// the bottom is deliberately secondary to the behavioural ones above it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CARRIER_KEYS, carrierMovement } from '../../../scripts/lib/carrier.mjs';

const GUARD = readFileSync(fileURLToPath(new URL('../../../scripts/refactor-guard.mjs', import.meta.url)), 'utf8');

const sample = (over = {}) => ({
  graphSha256: 'aaa', indexedCommit: 'c0ffee', nodes: 100, edges: 200, ...over,
});

describe('carrierMovement — the predicate that decides whether a run can attribute', () => {
  it('★★★ identical carriers report NO movement', () => {
    // ⛔ POSITIVE CONTROL FIRST. Every assertion below is about the predicate saying "moved"; if it
    // said "moved" unconditionally they would all pass and the gate would refuse every real slice.
    expect(carrierMovement(sample(), sample()), 'a settled carrier is comparable').toEqual([]);
  });

  it('★★★ each carrier field is load-bearing — none is decorative', () => {
    // Derived from CARRIER_KEYS rather than listed, so a key added to the carrier without being
    // wired into the comparison cannot sit there silently doing nothing.
    for (const key of CARRIER_KEYS) {
      const moved = carrierMovement(sample(), sample({ [key]: 'CHANGED' }));
      expect(moved, `${key} must be detected as movement`).toEqual([key]);
    }
  });

  it('★★★ THE ACTUAL BUG: a graph re-index mid-run is movement', () => {
    // This is the observed case, with the real shape: the reindex advances the snapshot to a new
    // commit and rewrites the db, so both the hash and the manifest move together.
    const before = sample({ graphSha256: 'aaa', indexedCommit: '6114b3a', nodes: 11871, edges: 40723 });
    const after = sample({ graphSha256: 'bbb', indexedCommit: '7c781c0', nodes: 11881, edges: 40758 });
    expect(carrierMovement(before, after)).toEqual(['graphSha256', 'indexedCommit', 'nodes', 'edges']);
  });

  it('★★★ FAIL CLOSED: a missing or null field is MOVEMENT, never agreement', () => {
    // ⛔ `undefined === undefined` is true. Without this, a sample taken while the graph was absent
    // would compare equal to another absent sample and let the run certify itself against nothing —
    // a guard that passes when its input is missing is decoration.
    const complete = sample();
    expect(carrierMovement(complete, { indexedCommit: 'c0ffee', nodes: 100, edges: 200 }),
      'absent on one side').toEqual(['graphSha256']);
    expect(carrierMovement(complete, sample({ graphSha256: null })),
      'null on one side').toEqual(['graphSha256']);
    expect(carrierMovement({}, {}), 'absent on BOTH sides is not agreement')
      .toEqual(CARRIER_KEYS);
    expect(carrierMovement(null, null), 'and neither is nothing at all').toEqual(CARRIER_KEYS);
  });

  it('★★★ workingTreeDirty is NOT movement — it changes on every real slice', () => {
    // The carrier records it for the reader, but treating it as movement would refuse the very
    // thing the guard exists to measure. Its only leak into output is separately excluded.
    expect(carrierMovement(sample({ workingTreeDirty: 0 }), sample({ workingTreeDirty: 12 })))
      .toEqual([]);
  });
});

describe('the guard samples the carrier on both sides of the run', () => {
  // ⚠ SOURCE ORDER, WHICH IS A WEAKER INSTRUMENT THAN THE ABOVE and is here only because the
  // ordering cannot be observed through the module boundary — main() is not callable from a test.
  const at = (needle) => GUARD.indexOf(needle);

  it('★★★ the second sample comes AFTER the corpus it certifies', () => {
    const beforeAt = at('const before = carrier();');
    const corpusAt = at('const results = await runCorpus();');
    const afterAt = at('const after = carrier();');

    // ⛔ Prove the markers exist, or these comparisons are -1 against -1 and pass vacuously.
    expect(beforeAt, 'pre-run sample present').toBeGreaterThan(-1);
    expect(corpusAt, 'corpus run present').toBeGreaterThan(-1);
    expect(afterAt, 'POST-run sample present — the one that was missing').toBeGreaterThan(-1);

    expect(beforeAt).toBeLessThan(corpusAt);
    expect(corpusAt, 'a second sample taken before the work is one moment read twice')
      .toBeLessThan(afterAt);
  });

  it('★★★ the mid-run refusal is distinguishable from the baseline-drift refusal', () => {
    // They mean different things: one says "re-baseline", the other says "the graph is moving under
    // you and nothing will attribute until it settles". Collapsing them sends the reader in a loop.
    const midRun = at('REFUSED: the carrier moved DURING the corpus run');
    const drift = at('REFUSED: the carrier moved, so this comparison cannot attribute');
    expect(midRun, 'mid-run refusal exists').toBeGreaterThan(-1);
    expect(drift, 'drift refusal exists').toBeGreaterThan(-1);
    expect(midRun, 'and mid-run movement is checked first').toBeLessThan(drift);
    expect(GUARD).toMatch(/Nothing here is evidence about the code/);
  });

  it('★★★ the key list has exactly one definition', () => {
    const inline = GUARD.split("['graphSha256', 'indexedCommit', 'nodes', 'edges']").length - 1;
    expect(inline, 'the literal list lives in lib/carrier.mjs, not here').toBe(0);
    expect(GUARD, 'and the guard imports the shared predicate').toMatch(/from '\.\/lib\/carrier\.mjs'/);
    expect(GUARD, 'and the extracted decision').toMatch(/from '\.\/lib\/guard-verdict\.mjs'/);
  });
});
