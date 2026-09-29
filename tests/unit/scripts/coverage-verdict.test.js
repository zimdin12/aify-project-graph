// ⛔⛔ THE PREDICATES BEHIND A REFUSAL, GIVEN A ROW INSTEAD OF ONE HAND-WATCH.
//
// dashboard-manager, 2026-09-29: "watching once and having a row are not the same thing, and I had been
// treating them as if they were." Both predicates here were watched red by hand, once, on the day they were
// written, inside `audit-rename-handling.mjs` — a 664-line self-executing script with no tests of its
// internals, which nothing automated runs, and which 19 commits rest claims on.
//
// They measured the mechanism on their own instrument: every guard with a testable SHAPE survived mutation,
// and every guard without one was never measured — and having a testable shape correlated almost perfectly
// with having been written as a function. THE SCRIPT/MODULE BOUNDARY DECIDED WHAT GOT CHECKED. That is why
// this file can exist at all: the predicates moved, unchanged, into a module the suite can import. The
// audit's output is byte-identical across the move.
//
// ⛔ WHAT THIS FILE DOES NOT COVER, said here rather than left to be assumed: the audit's ARMS. ARM E, G and
// H, the fixtures, and the git/db plumbing are still unreachable from the suite. This tests the two pure
// predicates and nothing else. A green here says the refusal logic is sound; it says NOTHING about whether
// the audit still runs.
import { describe, it, expect } from 'vitest';
import {
  skipReportCompleteness,
  classifyCoverage,
  coverageIsVacuous,
} from '../../../scripts/lib/coverage-verdict.mjs';

describe('skipReportCompleteness establishes the precondition positively', () => {
  it('★★★ a matching count and list length is COMPLETE — the positive control', () => {
    // Without this, every refusal arm below could pass for a predicate that refuses everything.
    expect(skipReportCompleteness({ files: [{ file: 'a.js' }], count: 1 }).complete).toBe(true);
    expect(skipReportCompleteness({ files: [], count: 0 }).complete).toBe(true);
  });

  it('★★★ a MISSING count refuses — `undefined > n` is false, so absence must not read as completeness', () => {
    // ⛔ THE TRAP THIS PREDICATE EXISTS FOR. A naive `claimed > files.length` check returns false for
    // undefined, so a skip report with no count at all would have been classified as untruncated.
    for (const absent of [undefined, null, 'seven', Number.NaN]) {
      const r = skipReportCompleteness({ files: [{ file: 'a.js' }], count: absent });
      expect(r.complete, `count=${JSON.stringify(absent)} must refuse`).toBe(false);
      expect(r.reason, 'and name the precondition it could not meet').toMatch(/no numeric count/u);
    }
    // No skip report at all, and a report with no count key, are the same case.
    expect(skipReportCompleteness(undefined).complete).toBe(false);
    expect(skipReportCompleteness({ files: [] }).complete).toBe(false);
  });

  it('★★★ a count LARGER than the list refuses — the truncation the 50-entry cap produces', () => {
    const r = skipReportCompleteness({ files: [{ file: 'a.js' }], count: 51 });
    expect(r.complete).toBe(false);
    expect(r.reason).toMatch(/TRUNCATED/u);
  });

  it('★★★ a count SMALLER than the list also refuses — either direction is a disagreement', () => {
    // Not symmetry for its own sake: the two numbers are two views of one array, and any disagreement is
    // exactly the state in which classification must not happen. A predicate that only caught truncation
    // would call an incoherent report complete.
    const r = skipReportCompleteness({ files: [{ file: 'a.js' }, { file: 'b.js' }], count: 1 });
    expect(r.complete).toBe(false);
    expect(r.reason).toMatch(/TRUNCATED/u);
  });
});

describe('classifyCoverage splits the gaps, or refuses carrying no verdict', () => {
  const GAPS = ['src/big.js', 'src/lost.js'];

  it('★★★ declared and undeclared gaps are separated — the positive control', () => {
    const v = classifyCoverage({
      population: 5,
      gaps: GAPS,
      skipReport: { files: [{ file: 'src/big.js', phase: 'too_large' }], count: 1 },
    });
    expect(v.refused).toBeNull();
    expect(v.declared, 'the gap the pass declared').toEqual(['src/big.js']);
    expect(v.unexplained, 'and the one it did not').toEqual(['src/lost.js']);
  });

  it('★★★ a refusal returns NULL for both buckets, never empty arrays', () => {
    // ⛔ AN EMPTY ARRAY READS AS "NONE FOUND", WHICH IS A VERDICT. `null` cannot be mistaken for one, and a
    // caller doing `unexplained.length === 0` throws instead of silently passing — which is the behaviour
    // wanted, because the alternative is a refusal that looks like a clean result.
    const v = classifyCoverage({ population: 5, gaps: GAPS, skipReport: { files: [], count: 9 } });
    expect(v.refused, 'the reason travels with the refusal').toMatch(/TRUNCATED/u);
    expect(v.unexplained).toBeNull();
    expect(v.declared).toBeNull();
    expect(() => v.unexplained.length).toThrow();
  });

  it('★★★ the gaps themselves survive a refusal — refusing to CLASSIFY is not refusing to REPORT', () => {
    const v = classifyCoverage({ population: 5, gaps: GAPS, skipReport: undefined });
    expect(v.gaps, 'a reader still needs to see what was found').toEqual(GAPS);
    expect(v.population).toBe(5);
  });

  it('★★★ no gaps and a complete report is a clean pass, not a refusal', () => {
    const v = classifyCoverage({ population: 5, gaps: [], skipReport: { files: [], count: 0 } });
    expect(v.refused).toBeNull();
    expect(v.unexplained).toEqual([]);
    expect(v.declared).toEqual([]);
  });
});

describe('coverageIsVacuous separates an empty population from a covered one', () => {
  it('★★★ population 0 is VACUOUS — it produces the same verdict as full coverage', () => {
    // The reachable failure of the whole limb: if the population walk returns nothing, "no unexplained
    // gaps" is true forever and indistinguishable from a real pass.
    expect(coverageIsVacuous({ population: 0, gaps: [], unexplained: [] })).toBe(true);
    expect(coverageIsVacuous({ population: 5, gaps: [], unexplained: [] })).toBe(false);
  });

  it('★★★ a missing verdict is vacuous, not clean — fail closed on absent input', () => {
    expect(coverageIsVacuous(undefined)).toBe(true);
    expect(coverageIsVacuous(null)).toBe(true);
  });
});
