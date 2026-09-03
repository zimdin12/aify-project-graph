// ⛔ DROPPING REPEATS MOVED THE ANALYSIS UNIT, AND THE REPORT DID NOT FOLLOW.
//
// With repeats=3 the per-arm counts in `buildReport` carried within-cell information. Steven dropped
// repeats on 2026-09-03 (72 runs → 24), so every per-arm count is now 0 or 1 and the only statement
// the design still supports — "the graph arm was safer in N of M cells" — was computed NOWHERE.
// A change to what may be claimed obliges a change to what is measured.
//
// ⛔ AND THE PAIRED VIEW IS THE EASIEST PLACE IN THIS WHOLE HARNESS TO BREAK THE KEY'S RULES. A
// single "N of 12" headline is exactly what a reader wants to quote, and it would average synthetic
// (tier A) with real (tier B) AND pool Hermes with Claude Code — both explicitly forbidden by the
// fixture's analysisRule. So the split is asserted here, not left to discipline.
import { describe, it, expect } from 'vitest';
import { buildPairedReport } from '../../../scripts/linkage-scope-runner.mjs';

const row = (tier, classId, arm, unsafe, runtime = 'mock') => ({
  tier, classId, arm, runtime, score: { unsafeAuthoritativeConclusion: unsafe, gateReached: true, sourceVerified: true },
});

describe('the paired report follows the analysis unit', () => {
  it('★★★ counts which ARM was safer on the same cell, in both directions', () => {
    const out = buildPairedReport([
      // graph refused, nograph concluded unsafe → graph safer
      row('A', 'C1', 'graph', false), row('A', 'C1', 'nograph', true),
      // the reverse must be counted too, or the instrument can only find good news
      row('A', 'C2', 'graph', true), row('A', 'C2', 'nograph', false),
      // both the same → neither
      row('A', 'C3', 'graph', false), row('A', 'C3', 'nograph', false),
    ]);
    expect(out.A.mock.graphSafer).toBe(1);
    expect(out.A.mock.nographSafer, 'a one-directional counter would hide the result that matters most').toBe(1);
    expect(out.A.mock.same).toBe(1);
  });

  it('⛔ TIERS ARE NEVER POOLED — the key forbids averaging synthetic with real', () => {
    const out = buildPairedReport([
      row('A', 'C1', 'graph', false), row('A', 'C1', 'nograph', true),
      row('B', 'C4', 'graph', false), row('B', 'C4', 'nograph', true),
    ]);
    expect(Object.keys(out).sort(), 'tier A and tier B must stay separate buckets').toEqual(['A', 'B']);
    expect(out.A.mock.graphSafer).toBe(1);
    expect(out.B.mock.graphSafer).toBe(1);
    // ⛔ There must be no combined bucket anywhere — a "2 of 2" total is the forbidden headline.
    expect(out.total, 'a cross-tier total is the exact number the key forbids').toBeUndefined();
  });

  it('⛔ RUNTIMES ARE NEVER POOLED EITHER — "reported separately, never pooled"', () => {
    const out = buildPairedReport([
      row('A', 'C1', 'graph', false, 'hermes'), row('A', 'C1', 'nograph', true, 'hermes'),
      row('A', 'C1', 'graph', true, 'claude-code'), row('A', 'C1', 'nograph', false, 'claude-code'),
    ]);
    expect(Object.keys(out.A).sort()).toEqual(['claude-code', 'hermes']);
    expect(out.A.hermes.graphSafer).toBe(1);
    expect(out.A['claude-code'].nographSafer, 'pooling would cancel these two into "same"').toBe(1);
  });

  it('★★★ an UNPAIRABLE cell is COUNTED and NAMED, never silently dropped', () => {
    // A cell where one arm errored cannot be compared. Dropping it shrinks the denominator, which is
    // the failure mode that has produced more wrong numbers in this project than any other — and it
    // shrinks it INVISIBLY, in the direction that makes the remaining pairs look cleaner.
    const out = buildPairedReport([
      row('A', 'C1', 'graph', false), row('A', 'C1', 'nograph', true),
      row('A', 'C2', 'graph', false), // nograph never ran
    ]);
    expect(out.A.mock.unpairable).toBe(1);
    expect(out.A.mock.unpairableCells.join(' '), 'the reader must be able to see WHICH cell and which arm')
      .toMatch(/C2.*nograph/);
    expect(out.A.mock.graphSafer, 'the pairable cell is still counted').toBe(1);
  });

  it('⛔ POSITIVE CONTROL: an empty row set produces no buckets, not a zero-filled report', () => {
    // A report that renders "graph safer 0/0" for a run that never happened reads as a measured
    // null. Absence of rows must produce absence of buckets.
    expect(buildPairedReport([])).toEqual({});
  });
});
