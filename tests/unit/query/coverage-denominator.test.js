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
import { computeCoverage, LSP_VERIFIABLE_LANGUAGES, isLspVerifiableLanguage } from '../../../mcp/stdio/query/coverage-denominator.js';
import { BACKENDS } from '../../../mcp/stdio/code-intel/backends.js';

describe('lsp coverage denominator', () => {
  it('★★ divides by the VERIFIABLE subset, not by every CALLS edge', () => {
    // The original defect, as arithmetic. 100 C++ edges all verified, plus 700 edges in a
    // language no backend here can verify. The honest answer is 100%; dividing by 800 gives 12%.
    //
    // ⚠ THE EXAMPLE LANGUAGE CHANGED, THE INVARIANT DID NOT. This case used `javascript` as the
    // stand-in for "unverifiable", which was TRUE when written and is now FALSE: the server grew a
    // TypeScript backend, and ts-langserver verifies 949 JS/TS CALLS edges in this very repo. A
    // premise expired underneath a correct test. `php` has no backend and is the honest stand-in.
    const rows = [
      { lang: 'cpp', c: 100, inScope: true },
      { lang: 'php', c: 700, inScope: true },
    ];
    const r = computeCoverage(rows, 100);

    expect(r.verifiable, 'php edges have no backend in this server').toBe(100);
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
    // ⚠ `javascript` and `python` used to appear here as excluded languages. Both are verifiable
    // now — the server registers backends for them — so the examples were replaced with languages
    // that genuinely have none. The invariant is untouched: what is excluded must be visible.
    const r = computeCoverage([
      { lang: 'cpp', c: 10, inScope: true },
      { lang: 'php', c: 40, inScope: true },
      { lang: 'glsl', c: 5, inScope: true },
    ], 10);

    expect(r.unverifiable.map((u) => u.lang).sort()).toEqual(['glsl', 'php']);
    expect(r.unverifiable.every((u) => u.reason === 'no_lsp_backend_for_language')).toBe(true);
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
    // `php` rather than `javascript`: JS is verifiable now (the TS backend handles it), so it no
    // longer produces the empty denominator this case needs.
    const r = computeCoverage([{ lang: 'php', c: 10, inScope: true }], 0);
    expect(r.verifiable).toBe(0);
    expect(r.pct).toBe(0);
    expect(Number.isNaN(r.pct)).toBe(false);
  });

  it('verifiability is scoped to languages a backend here actually covers', () => {
    // Kept as a structural assertion because the SET is the contract — but on the
    // exported value, not on a regex over the file that happens to define it.
    //
    // ⚠ THIS TEST USED TO ASSERT javascript AND python WERE EXCLUDED, and it was right when the
    // server was C++-only. Both are verifiable now. Rather than swap one hand-written list for
    // another, the expectation is HARVESTED FROM BACKENDS — the table that decides which server
    // spawns — so a backend added later cannot silently fall out of the denominator again.
    for (const lang of Object.keys(BACKENDS)) {
      expect(LSP_VERIFIABLE_LANGUAGES.has(lang), `${lang} has a backend and must be verifiable`).toBe(true);
    }
    // JavaScript has no backend of its own; it is verifiable because the TS server answers it.
    expect(isLspVerifiableLanguage('javascript')).toBe(true);
    // POSITIVE CONTROL on the exclusion half: a language with no backend must still be excluded,
    // or the set has become "everything" and the denominator means nothing.
    expect(isLspVerifiableLanguage('php')).toBe(false);
    expect(isLspVerifiableLanguage('glsl')).toBe(false);
  });

  // ⛔ THE FIELD SHIPPED A PERCENTAGE OF 4995, AND THIS FUNCTION ROUNDED IT WITHOUT COMPLAINT.
  //
  // Found live by ef-manager, 2026-09-05, in graph_health — the verb whose entire job is answering
  // "can I trust what I am about to be told":
  //
  //     lspVerifiedPctOfVerifiableInScopeCalls: 4995
  //     lspVerifiedEdges: 949 · lspCallsVerifiable: 19 · 949/19 × 100 = 4995
  //
  // The numerator counted EVERY LSP_VERIFIED edge in the database, any relation, repo-wide. The
  // denominator counted in-scope C++ CALLS edges. Two populations, one ratio.
  //
  // ⭐ THE EXPECTATION HERE IS A MATHEMATICAL INVARIANT, NOT A READING OF THE CODE: when the
  // numerator is a subset of the denominator, the ratio cannot exceed 100. If it does, the inputs
  // are incommensurable and the honest output is a refusal, not a rounded number. The existing guard
  // covered a zero denominator and stopped there — it protected against NaN, which is visibly
  // broken, and not against 4995, which merely looks precise.
  describe('an impossible percentage is refused, not rounded', () => {
    it('★★★ verified > verifiable yields NO percentage and names the reason', () => {
      const r = computeCoverage([{ lang: 'cpp', c: 19, inScope: true }], 949);
      expect(r.pct, 'a subset cannot exceed its superset — this input is incommensurable').toBeNull();
      expect(r.pctUnavailableReason).toMatch(/incommensurable|different population|exceeds/i);
    });

    it('★★★ POSITIVE CONTROL: a legitimate ratio still produces a number', () => {
      // Without this, refusing everything would satisfy the test above while destroying the field —
      // the way a guard added earlier this session refused every database.
      const r = computeCoverage([{ lang: 'cpp', c: 20, inScope: true }], 5);
      expect(r.pct).toBe(25);
      expect(r.pctUnavailableReason ?? null).toBeNull();
    });

    it('★★★ the boundary is INCLUSIVE — full coverage is 100, not a refusal', () => {
      const r = computeCoverage([{ lang: 'cpp', c: 20, inScope: true }], 20);
      expect(r.pct).toBe(100);
    });

    it('★★ a zero denominator still reports 0 rather than NaN', () => {
      // The guard that already existed must survive the new one.
      expect(computeCoverage([], 0).pct).toBe(0);
    });
  });
});
