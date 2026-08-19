// ⛔⛔⛔ REMEDY 3 — 100% COMPILE-DB MEMBERSHIP IS NOT PROOF CLANGD INDEXED THE TU.
//
// graph-senior-dev executed this against real clangd/clang-cl 22.1.6 on committed 7a46e4c,
// AFTER the coverage fix landed:
//   include/api.h defines target(); src/visible.cpp and src/hidden.cpp each call it.
//   BOTH are in compile_commands — 2 on disk, 2 covered, ratio 1, censusFresh true.
//   hidden's DB command deliberately omits the include path.
//   Positive control: compiling both WITH the right flag exits 0.
//   Failure control: compiling hidden with its ACTUAL DB flags exits 1 — 'api.h' file not found.
//   Result: coverage {complete:true, fullyCovered:true, ratio:1}, freshness fresh,
//           source calls [visible, hidden], returned references [visible],
//           evidence {exhaustive:true, degraded:false, cause:null, confidence:'high'}.
//
// ★ MECHANISM, from upstream clangd source: Background.cpp:331-345 logs `Indexed <TU>` and,
// on an uncompilable diagnostic, `Failed to compile <TU>, index may be incomplete` — but
// BackgroundQueue.cpp:43,49 increments `Completed` after EVERY task regardless of outcome.
// So `$/progress` draining to idle proves only that all tasks TERMINATED, never that they
// succeeded. That is exactly why our `fresh` bit stayed green over a failed TU.
//
// ⇒ THE GRANT IS WITHHELD UNTIL THE INDEX POPULATION IS ATTESTED. We can observe which TUs
// were SELECTED (compile-DB membership) and cannot observe which were INDEXED. A claim of
// completeness over an unobserved population is the same defect as the 90% threshold one
// layer in: membership was standing in for success.
//
// ⚠ WHY THIS COSTS LESS THAN IT LOOKS, and it is the fact that makes withholding safe:
// the grant only ever fired with callsiteCount > 0 — "here are N callers and that is all of
// them". The zero-caller shape that licenses a DELETION already returned definition_only /
// exhaustive:false and never got the grant. So this removes a claim that was proven false in
// exactly the case where it fired, and removes nothing from deletion safety, which never had it.
//
// ⚠ SCOPED TO WHAT WAS EXECUTED. The grant site is only reachable when `coverage.complete` is
// true, which is the C++/clangd path. Non-cpp callers pass no coverage and were already
// downgraded by the fail-closed gate. This does not extend a clangd finding to tsserver —
// the same discipline graph-senior-dev applied to my localization/reference over-extension.
import { describe, it, expect } from 'vitest';
import { buildReferencesEvidence } from '../../../mcp/stdio/query/verbs/code_intel_live.js';

// Exactly the coverage object dev's fixture produced: fully covered, freshly measured.
const perfectCoverage = {
  complete: true,
  fullyCovered: true,
  censusFresh: true,
  reason: null,
  foreignToolchain: false,
  unityUnexpanded: false,
  noFirstParty: false,
  fileUncovered: false,
  poorlyCovered: false,
  coverageRatio: 1,
  firstPartySourcesOnDisk: 2,
  firstPartySourcesCovered: 2,
};

const query = {
  freshness: 'fresh', callsiteCount: 1, defCount: 1, resultState: 'found', coverage: perfectCoverage,
};

describe('the exhaustive grant under an unattested index', () => {
  it('★★★ is WITHHELD even at 100% membership with a freshly measured census', () => {
    const ev = buildReferencesEvidence(query);
    expect(ev.exhaustive, 'membership is selection, not success — a TU in the DB may have failed to compile')
      .toBe(false);
  });

  it('★★★ names the unattested population as the cause', () => {
    const ev = buildReferencesEvidence(query);
    expect(ev.cause, 'a withheld grant with no cause misdirects the remedy').toBeTruthy();
    expect(String(ev.cause)).toMatch(/unattested|index/i);
  });

  it('★★★ still reports what IS known — precision survives when completeness does not', () => {
    // dev's usability ruling: a negative that returns nothing useful teaches agents to stop
    // reading the field. Returned locations are compiler-resolved whether or not the set is
    // complete, and those are two different dimensions.
    const ev = buildReferencesEvidence(query);
    expect(ev.precision, 'each returned location is still compiler-resolved').toBe('compiler_resolved');
    expect(ev.completeness, 'the SET is a floor; say so as its own dimension').toBe('floor');
    expect(ev.indexPopulation, 'name what we could not observe').toBe('unattested');
  });

  it('★★★ keeps repositoryExhaustive separate from any scoped completeness', () => {
    // The two must never be one field again. A build-config-scoped answer can never license a
    // repo-wide deletion, and collapsing them is how it would.
    const ev = buildReferencesEvidence(query);
    expect(ev.repositoryExhaustive, 'no attested generation exists, so this cannot be true').toBe(false);
  });

  it('★★★ a genuinely degraded case still reports ITS cause, not the new one', () => {
    // The new gate must not swallow more specific attributions — the same cause-honesty
    // failure my first coverage-reason ordering caused earlier today.
    const ev = buildReferencesEvidence({
      ...query,
      coverage: { ...perfectCoverage, complete: false, fullyCovered: false, coverageRatio: 0.5, poorlyCovered: true, reason: 'the compile DB covers 1 of ~2 first-party sources' },
    });
    expect(ev.exhaustive).toBe(false);
    expect(String(ev.cause), 'coverage is the nearer cause here').not.toMatch(/unattested/i);
  });
});
