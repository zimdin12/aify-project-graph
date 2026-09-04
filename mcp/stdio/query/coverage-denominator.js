import { BACKENDS, normalizeLanguage } from '../code-intel/backends.js';

// ★ THE DENOMINATOR, EXTRACTED SO IT CAN BE RUN INSTEAD OF GREPPED.
//
// `lspVerifiedPct` was computed inline in health.js, so the only way to guard it was to
// assert regexes over that file — eight of them, all spelling. the field test rates this
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

// ⛔ THIS SET WAS HARDCODED TO C++ AND THE SERVER GREW TWO MORE BACKENDS UNDER IT.
//
// It read `['cpp','c','cxx','cc','h','hpp']`, so TypeScript and Python were classed "unverifiable
// by construction" — while ts-langserver was verifying 949 TypeScript/JavaScript CALLS edges in this
// very repo. The denominator therefore excluded exactly the population being verified, the numerator
// counted them anyway, and graph_health published a coverage figure of 4995%.
//
// Measured on this repo at the time of the fix:
//     hardcoded set : 0 / 19      ->    0%   (C++ only, a trivial population)
//     derived set   : 949 / 11267 ->    8%   (what the server can actually verify)
// and inside that, typescript is 859/862 while javascript is 90/10374 — a real signal the broken
// number was hiding.
//
// ⭐ DERIVED, NOT LISTED. `BACKENDS` is what decides which server spawns for a language, so a
// backend added later becomes verifiable here without anyone remembering to edit this line.
// `normalizeLanguage` is what maps javascript onto the TypeScript server, so JS counts as
// verifiable for the same reason the router treats it that way.
const VERIFIABLE_BACKENDS = new Set(Object.keys(BACKENDS));

// ⚠ HEADER TAGS ARE KEPT EXPLICITLY, BECAUSE normalizeLanguage DOES NOT MAP THEM. Measured:
// 'cc'/'cxx'/'c' normalize to 'cpp', but 'h'/'hpp'/'hxx' return themselves unchanged. Deriving the
// set purely from the normalizer therefore DROPPED them — and dropping a language SHRINKS the
// denominator, which INFLATES the coverage percentage. That is the wrong direction for a trust
// figure, so the C-family aliases are unioned in rather than filtered.
const C_FAMILY_TAGS = ['c', 'cc', 'cxx', 'h', 'hh', 'hpp', 'hxx'];

/** Can any backend registered in THIS server verify an edge from a file of `lang`? */
export function isLspVerifiableLanguage(lang) {
  const l = String(lang || '').toLowerCase();
  return VERIFIABLE_BACKENDS.has(normalizeLanguage(l)) || C_FAMILY_TAGS.includes(l);
}

// ⚠ Retained as a value for readers, but DERIVED now rather than maintained by hand.
export const LSP_VERIFIABLE_LANGUAGES = new Set([...VERIFIABLE_BACKENDS, ...C_FAMILY_TAGS]);

// ⚠ RESIDUAL, MEASURED AND LEFT: this graph also carries the node language tags `js_ts` and `c_cpp`,
// which normalize to themselves and are therefore NOT counted as verifiable. Neither carries a
// single CALLS edge here, so the figures above are unaffected — but a repo where they do would
// under-count its denominator. Recorded rather than guessed at.

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
    .filter((r) => isLspVerifiableLanguage(r.lang))
    .reduce((a, r) => a + r.c, 0);

  const unverifiable = inScopeRows
    .filter((r) => !isLspVerifiableLanguage(r.lang))
    // ⛔ WAS 'non_cpp_language', WHICH IS NOW A MISATTRIBUTED CAUSE — Python is non-C++ AND
    // verifiable. The real reason an edge is excluded is that no backend in this server
    // handles its language, which is what the predicate above actually tests.
    .map((r) => ({ reason: 'no_lsp_backend_for_language', lang: r.lang, count: r.c }));

  // ⛔ A PERCENTAGE OF 4995 SHIPPED IN graph_health, AND THIS FUNCTION ROUNDED IT WITHOUT COMPLAINT.
  //
  // Found live 2026-09-05: numerator 949 (every LSP_VERIFIED edge in the database, any relation,
  // repo-wide) over denominator 19 (in-scope C++ CALLS edges). Two populations, one ratio.
  //
  // The old guard covered a ZERO denominator — it protected against NaN, which is visibly broken,
  // and not against 4995, which merely looks precise. `verified` is supposed to be a SUBSET of
  // `verifiable`, so exceeding it is not a large coverage figure; it is proof the two arguments
  // counted different things, and the only honest output is a refusal that says so.
  const incommensurable = verifiable > 0 && verified > verifiable;

  return {
    verifiable,
    verified,
    // Guard the divide: a zero denominator reports 0, never NaN or Infinity — a NaN
    // percentage renders as a plausible-looking blank rather than as an error.
    //
    // ⛔ AND NULL RATHER THAN A CLAMP. Clamping 4995 to 100 would report PERFECT coverage from
    // inputs known to be broken — the worst available answer, and one no reader could question.
    pct: incommensurable ? null : (verifiable > 0 ? Math.round((verified / verifiable) * 100) : 0),
    pctUnavailableReason: incommensurable
      ? `incommensurable inputs: ${verified} verified exceeds ${verifiable} verifiable, so the two `
        + 'counted different populations and no percentage is meaningful'
      : null,
    // The denominator names its own population. This is the `basis` pattern that §4 of
    // the plan generalises from — a ratio that travels without its denominator is how
    // two correct numbers produce a wrong comparison.
    denominator: 'verifiable_and_in_scope_calls',
    outOfScope: outOfScopeRows.reduce((a, r) => a + r.c, 0),
    unverifiable,
  };
}
