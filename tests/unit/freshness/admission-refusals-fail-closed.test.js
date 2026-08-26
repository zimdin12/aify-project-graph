import { describe, expect, it } from 'vitest';
import { classifyUnresolvedRef } from '../../../mcp/stdio/freshness/unresolved-categorization.js';
import { countTrustRelevantDirtyEdges, explainTrustExclusions } from '../../../mcp/stdio/freshness/unresolved-metrics.js';

// ⛔⛔ A BLANKET `Boolean(refusedReason)` BUCKET KILLED THE TRUST SIGNAL, AND THE COMMIT THAT SHIPPED
// IT CLAIMED THE DENOMINATOR WAS UNCHANGED.
//
// Retaining admission refusals in the unresolved carrier was right — a typed refusal must not be
// indistinguishable from a ref nobody considered. Excluding EVERY refusal from trust was not.
//
// ⭐ MEASURED on this repository, full index:
//
//     blanket bucket (as shipped)   trustDirtyEdgeCount = 0        <- the signal was dead
//     no bucket at all              trustDirtyEdgeCount = 27,957   <- inflated by local names
//     one named reason (correct)    trustDirtyEdgeCount = 38
//
// And the per-reason breakdown is why the correct rule is NARROW — of the four reasons the admission
// owner emits, the pre-existing classifiers already handle three:
//
//     references-bare-local-name     28,070  ->  27,919 trust-relevant   (needs the exclusion)
//     common-name-not-worth-minting   5,057  ->       0   (denylisted-by-design:common-name)
//     relation-not-admitted:IMPORTS   4,739  ->       2   (external-by-design:npm / node-builtin)
//     fragment-shape-not-minted         833  ->      36   (mostly external-by-design:node-builtin)
//
// ⇒ So the bucket names ONE reason and everything else falls through. That is the fail-closed
// direction: a reason nobody has classified yet stays TRUST-RELEVANT until someone decides.

const ref = (refusedReason, over = {}) => ({
  from_id: 'fn:a', relation: 'REFERENCES', target: 'lowerlocal',
  source_file: 'src/a.js', source_line: 1, refusedReason, ...over,
});

describe('admission refusals are classified fail-closed', () => {
  it('⛔ the one measured exclusion: a refused bare local name is not trust-relevant', () => {
    expect(classifyUnresolvedRef(ref('references-bare-local-name')))
      .toBe('external-by-design:admission-refused-local-name');
    expect(countTrustRelevantDirtyEdges([ref('references-bare-local-name')])).toBe(0);
  });

  it('⛔⛔ AN UNKNOWN FUTURE REASON STAYS TRUST-RELEVANT', () => {
    // The load-bearing assertion in this file. Under the blanket test this was 0, so any reason
    // added later would leave the denominator silently — before anyone judged whether it marked a
    // product defect.
    const verdict = classifyUnresolvedRef(ref('some-reason-invented-next-year', { target: 'someName' }));
    expect(verdict).not.toBe('external-by-design:admission-refused-local-name');
    expect(countTrustRelevantDirtyEdges([ref('some-reason-invented-next-year', { target: 'someName' })]))
      .toBe(1);
  });

  it('⭐ the other current reasons keep the classification they already had', () => {
    // Not "excluded because they are refusals" — excluded (or not) on their own merits, by rules that
    // predate the admission owner. A refusal reason must not be able to override that.
    expect(classifyUnresolvedRef(ref('common-name-not-worth-minting', { target: 'get', relation: 'CALLS' })))
      .toBe('denylisted-by-design:common-name');
    expect(classifyUnresolvedRef(ref('relation-not-admitted:IMPORTS', { target: 'node:fs', relation: 'IMPORTS' })))
      .toMatch(/^external-by-design:/);
  });

  it('⛔ a refused SHAPE issue is not laundered into "external by design"', () => {
    // `fragment-shape-not-minted` is a parse problem, not a dependency that lives outside the repo.
    // Calling it external-by-design would have told a reader the graph is fine when it is not.
    const verdict = classifyUnresolvedRef(ref('fragment-shape-not-minted', { target: '(((', relation: 'CALLS' }));
    expect(verdict).not.toBe('external-by-design:admission-refused-local-name');
  });

  it('⛔ the excluded population is published under its OWN name, not a family total', () => {
    // explainTrustExclusions collapsed every `external-by-design:*` bucket into one row, so an
    // admission refusal was indistinguishable from an npm package — and the claim that the count was
    // published was false for the named population.
    const explained = explainTrustExclusions([
      ref('references-bare-local-name'),
      ref('references-bare-local-name'),
      ref('relation-not-admitted:IMPORTS', { target: 'node:fs', relation: 'IMPORTS' }),
    ]);
    const named = explained.excluded.find((e) => e.reason === 'external-by-design:admission-refused-local-name');
    expect(named, 'the reader must be able to see which exclusion this was').toBeTruthy();
    expect(named.count).toBe(2);
    // ⭐ CONTROL: the other families still report under their summary name, so no existing reader
    // loses a row it was already consuming.
    expect(explained.excluded.some((e) => e.reason === 'external-by-design')).toBe(true);
  });
});
