// ★ THE DENOMINATOR, EXTRACTED SO IT CAN BE RUN INSTEAD OF GREPPED.
//
// `lspVerifiedPct` was computed inline in health.js, so the only way to guard it was to
// assert regexes over that file — eight of them, all spelling. ef-manager rates this
// denominator among the fields they ACTUALLY USED (they checked the 833/1599 arithmetic
// against it), which makes a test that cannot fail on a wrong number the worst kind to
// have here.
//
// Pulling it out is a small refactor with a large consequence: the invariant becomes
// checkable by calling it with rows and comparing integers.
//
// THE INVARIANTS, each of which was a real defect at some point:
//
//  1. DIVIDE BY THE VERIFIABLE SUBSET, NOT BY EVERY CALLS EDGE. Dividing by all calls
//     reported 12% on a repo where every verifiable edge was verified — a number that
//     read as a coverage failure and was an accounting one.
//  2. OUT-OF-SCOPE EDGES NEVER ENTER, AND NEVER MIGRATE IN. An edge outside the tracked
//     corpus is not verifiable debt; if a backend for its language later lands, it must
//     not silently appear in the denominator and drop the percentage.
//  3. UNVERIFIABLE-BY-CONSTRUCTION IS NOT UNVERIFIED-BY-OMISSION. A JS edge in a C++-only
//     collection was never going to be verified. Counting it as a miss blames the tool
//     for a language it does not claim.
//  4. UNKNOWN SCOPE ≠ EVERYTHING IN SCOPE. If the tracked-file list cannot be read, the
//     honest answer is that scope is unknown — not that every edge is in it.

// Languages an LSP backend in this server can actually verify. Anything else is
// unverifiable by construction.
export const LSP_VERIFIABLE_LANGUAGES = new Set(['cpp', 'c', 'cxx', 'cc', 'h', 'hpp']);

/**
 * @param {Array<{lang: string, c: number, inScope?: boolean}>} langScopeRows
 *        one row per (language, scope) bucket with a count.
 * @param {number} verified  edges actually verified by an LSP backend.
 * @returns {{
 *   verifiable: number, verified: number, pct: number,
 *   denominator: string,
 *   outOfScope: number,
 *   unverifiable: Array<{reason: string, lang: string, count: number}>
 * }}
 */
export function computeCoverage(langScopeRows = [], verified = 0) {
  const outOfScopeRows = langScopeRows.filter((r) => r.inScope === false);
  const inScopeRows = langScopeRows.filter((r) => r.inScope !== false);

  const verifiable = inScopeRows
    .filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang))
    .reduce((a, r) => a + r.c, 0);

  const unverifiable = inScopeRows
    .filter((r) => !LSP_VERIFIABLE_LANGUAGES.has(r.lang))
    .map((r) => ({ reason: 'non_cpp_language', lang: r.lang, count: r.c }));

  return {
    verifiable,
    verified,
    // Guard the divide: a zero denominator reports 0, never NaN or Infinity — a NaN
    // percentage renders as a plausible-looking blank rather than as an error.
    pct: verifiable > 0 ? Math.round((verified / verifiable) * 100) : 0,
    // The denominator names its own population. This is the `basis` pattern that §4 of
    // the plan generalises from — a ratio that travels without its denominator is how
    // two correct numbers produce a wrong comparison.
    denominator: 'verifiable_and_in_scope_calls',
    outOfScope: outOfScopeRows.reduce((a, r) => a + r.c, 0),
    unverifiable,
  };
}
