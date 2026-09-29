// PURE. No filesystem, no git, no database — which is the entire point of the file existing.
//
// ⛔⛔ WHY THIS IS A MODULE AND NOT A FUNCTION INSIDE THE AUDIT.
//
// dashboard-manager measured it on their own instrument, 2026-09-29: every guard with a testable SHAPE
// survived mutation, and every guard without one was NEVER MEASURED — and "does it have a testable shape"
// correlated almost perfectly with "did I write it as a function". THE SCRIPT/MODULE BOUNDARY DECIDED WHAT
// GOT CHECKED. Not priority, not judgement, not quality. File shape.
//
// That is exactly `audit-rename-handling.mjs`: 664 lines, self-executing on import, ZERO tests of its
// internals — not among the 67 `scripts/` modules any test imports, out of 161. Nothing automated runs it:
// not `package.json`, not the hooks, not `run-suite`, not `gated-push`. 19 commits rest claims on its arms.
//
// ⚠ And their sentence that decided which part to pull out first: "watching once and having a row are not
// the same thing, and I had been treating them as if they were." The two predicates below are the ones I
// built on 2026-09-29 and watched red BY HAND, ONCE. Everything else in that audit is older and no better
// covered, but these are the ones whose failure mode is a REFUSAL THAT QUIETLY STOPS REFUSING.
//
// ⛔ NOT PULLED OUT, DELIBERATELY: `presentWithExactCase`. It is reimplemented inside the audit so the fix
// cannot grade its own homework. DUPLICATION FOR INDEPENDENCE IS NOT DUPLICATION — dashboard-manager's
// test for it: would you still want the second implementation if the first were correct? Yes. So it is a
// control, not a copy, and collapsing it under "one owner" would delete the only thing it provides.

/**
 * Can DECLARED gaps be told apart from UNDECLARED ones, given what the pass handed over?
 *
 * ⛔ THE PRECONDITION IS ESTABLISHED POSITIVELY, NEVER ASSUMED. `skippedFiles` is truncated to 50 entries
 * by `orchestrator.js:1028`. Past the cap a gap the pass DECLARED reads as unexplained — a red that is a
 * lie about a file the cap deliberately left alone, and the repair somebody reaches for is widening the
 * allowance, which loses the real direction permanently and quietly.
 *
 * ⇒ A CHECK THAT CANNOT TELL WHICH OF TWO WORLDS IT IS IN MUST NOT REPORT EITHER.
 *
 * ⭐ Detection reads the ARTIFACT, not a producer flag: two views of one array, how many the pass says it
 * skipped against how many it actually handed over. Nothing asks "did you truncate?", and nothing hardcodes
 * 50 — a number somebody would have to remember to update when the cap moves.
 *
 * ⚠ FAILS CLOSED ON ITSELF. `undefined > n` is FALSE, so a naive comparison would read a MISSING count as
 * nothing-was-truncated. Completeness must be proven, not defaulted to.
 *
 * ⚠ A count SMALLER than the list is also incoherent, not just a larger one. Either direction means the two
 * views disagree, and a disagreement is exactly the state where classification must not happen.
 */
export function skipReportCompleteness(skipReport) {
  const files = skipReport?.files ?? [];
  const claimed = skipReport?.count;

  if (typeof claimed !== 'number' || Number.isNaN(claimed)) {
    return {
      complete: false,
      reason: `skip report carries no numeric count (got ${JSON.stringify(claimed)}), `
        + 'so completeness cannot be established',
    };
  }
  if (claimed !== files.length) {
    return {
      complete: false,
      reason: `the pass reports ${claimed} skipped file(s) but handed over ${files.length}, `
        + 'so the skip report is TRUNCATED',
    };
  }
  return { complete: true, reason: null };
}

/**
 * Split the gaps into DECLARED and UNDECLARED — or refuse, carrying no verdict to misread.
 *
 * ⛔ A REFUSAL RETURNS `null` FOR BOTH BUCKETS RATHER THAN EMPTY ARRAYS. An empty array reads as "none
 * found", which is a verdict; `null` cannot be mistaken for one, and a caller doing
 * `unexplained.length === 0` throws instead of silently passing.
 */
export function classifyCoverage({ population, gaps, skipReport }) {
  const completeness = skipReportCompleteness(skipReport);
  if (!completeness.complete) {
    return { population, gaps, refused: completeness.reason, unexplained: null, declared: null };
  }
  const declaredFiles = new Set((skipReport?.files ?? []).map((s) => s.file));
  return {
    population,
    gaps,
    refused: null,
    unexplained: gaps.filter((g) => !declaredFiles.has(g)),
    declared: gaps.filter((g) => declaredFiles.has(g)),
  };
}

/**
 * Is this verdict worth reading at all?
 *
 * ⭐⭐ PRINT THE POPULATION BESIDE THE VERDICT. The reachable failure is not a wrong answer, it is a VACUOUS
 * one: an empty population produces "no unexplained gaps" forever, and an empty population and a
 * fully-covered one give the IDENTICAL verdict. The count is the only thing that separates them.
 */
export function coverageIsVacuous(verdict) {
  return !verdict || verdict.population === 0;
}
