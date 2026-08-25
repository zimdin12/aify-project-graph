// THE DENOMINATOR DECIDES WHETHER A COVERAGE NUMBER MEANS ANYTHING.
//
// Dividing verified edges by EVERY CALLS edge reported 12% on a repo where every
// verifiable edge had in fact been verified. That reads as a coverage failure and was an
// accounting one — and the field test checked the 833/1599 arithmetic against this exact
// field, which makes it one of the few they confirmed they actually use.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.
//
// The previous version was eight regexes over health.js: `verified / verifiable`,
// `verifiable_and_in_scope_calls`, `lspOutOfScopeCalls`, `LSP_VERIFIABLE_LANGUAGES`, and
// so on. Every one asserts SPELLING. None could fail on a wrong number — and a wrong
// number is the entire failure mode of a coverage statistic.
//
// The computation was inline in health.js, which is why it had never been tested by
// running it. It now lives in `query/coverage-denominator.js` and this calls it with rows
// and compares integers.
import { describe, it, expect } from 'vitest';
import { computeCoverage, LSP_VERIFIABLE_LANGUAGES } from '../../../mcp/stdio/query/coverage-denominator.js';

describe('lsp coverage denominator', () => {
  it('★★ divides by the VERIFIABLE subset, not by every CALLS edge', () => {
    // The original defect, as arithmetic. 100 C++ edges all verified, plus 700 JS edges
    // no backend here can verify. The honest answer is 100%; dividing by 800 gives 12%.
    const rows = [
      { lang: 'cpp', c: 100, inScope: true },
      { lang: 'javascript', c: 700, inScope: true },
    ];
    const r = computeCoverage(rows, 100);

    expect(r.verifiable, 'JS edges are not verifiable by this backend').toBe(100);
    expect(r.pct, 'every verifiable edge was verified — that is 100%, not 12%').toBe(100);
  });

  it('★★ out-of-scope edges never enter the denominator', () => {
    // Attack nine: an edge outside the tracked corpus is not verification debt.
    const rows = [
      { lang: 'cpp', c: 50, inScope: true },
      { lang: 'cpp', c: 950, inScope: false },
    ];
    const r = computeCoverage(rows, 50);

    expect(r.verifiable).toBe(50);
    expect(r.outOfScope).toBe(950);
    expect(r.pct).toBe(100);
  });

  it('★★ and out-of-scope edges do NOT migrate in when their language becomes verifiable', () => {
    // The subtler half of attack nine, and the one a spelling test cannot express: an
    // out-of-scope C++ edge is ALREADY in a verifiable language. If scope were ignored it
    // would sit in the denominator and drag the percentage down for a corpus we never
    // claimed to cover. Scope is checked FIRST, independently of language.
    const inScopeOnly = computeCoverage([{ lang: 'cpp', c: 10, inScope: true }], 10);
    const withOutOfScope = computeCoverage([
      { lang: 'cpp', c: 10, inScope: true },
      { lang: 'cpp', c: 10_000, inScope: false },
    ], 10);

    expect(withOutOfScope.pct, 'adding out-of-scope work must not change coverage')
      .toBe(inScopeOnly.pct);
  });

  it('★ reports the excluded population separately, with a reason per language', () => {
    // Excluding silently would be the same defect wearing a better number — the reader
    // must be able to see what was taken out and why.
    const r = computeCoverage([
      { lang: 'cpp', c: 10, inScope: true },
      { lang: 'javascript', c: 40, inScope: true },
      { lang: 'python', c: 5, inScope: true },
    ], 10);

    expect(r.unverifiable.map((u) => u.lang).sort()).toEqual(['javascript', 'python']);
    expect(r.unverifiable.every((u) => u.reason === 'non_cpp_language')).toBe(true);
    expect(r.unverifiable.reduce((a, u) => a + u.count, 0)).toBe(45);
  });

  it('★ the denominator names its own population', () => {
    // §4's basis rule: a ratio that travels without its denominator is how two correct
    // numbers produce a wrong comparison. This is the field the field test used to check the
    // 833/1599 arithmetic.
    expect(computeCoverage([], 0).denominator).toBe('verifiable_and_in_scope_calls');
  });

  it('a zero denominator reports 0, never NaN', () => {
    // A NaN percentage renders as a plausible-looking blank rather than as an error.
    const r = computeCoverage([{ lang: 'javascript', c: 10, inScope: true }], 0);
    expect(r.verifiable).toBe(0);
    expect(r.pct).toBe(0);
    expect(Number.isNaN(r.pct)).toBe(false);
  });

  it('verifiability is scoped to languages a backend here actually covers', () => {
    // Kept as a structural assertion because the SET is the contract — but on the
    // exported value, not on a regex over the file that happens to define it.
    expect(LSP_VERIFIABLE_LANGUAGES.has('cpp')).toBe(true);
    expect(LSP_VERIFIABLE_LANGUAGES.has('javascript')).toBe(false);
    expect(LSP_VERIFIABLE_LANGUAGES.has('python')).toBe(false);
  });
});
