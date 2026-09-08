// THE JOIN — WITHDRAWN.
//
// This module loaded two stored digests and computed the delta between them. It was the single
// boundary both renderers went through, which is why the withdrawal lives here: one refusal, and no
// consumer can page past it.
//
// ⛔⛔ WHY IT IS WITHDRAWN RATHER THAN CAVEATED. A digest is keyed by commit sha and built from
// whatever the indexer PARSED. Nothing binds those bytes to the source that commit contained, and
// two paths publish a digest describing source the commit never held — neither needing an edit
// during the run:
//
//   1. INHERITED ROWS. Index with a dirty file, restore it, commit something unrelated, index again.
//      Only the changed file is reprocessed, so the stale symbol survives in the graph and is
//      published under the new commit. The tree is clean at both endpoints and HEAD never moves.
//   2. `git update-index --assume-unchanged` hides a modified file from porcelain entirely, so a
//      status check cannot see it at all.
//
// An earlier guard checked the working tree at the start and end of a run and treated that as
// attribution. It is not: it attests TREE STATE, not the provenance of the rows the graph carries.
// That was an acceptance predicate lowered to what was cheap to build.
//
// ⭐ A CAVEAT BESIDE AN AVAILABLE DELTA STILL HANDS OVER THE UNSUPPORTED NUMBER. Whichever the
// reader believes, the figures are the part they act on. So the comparison is refused, and the
// refusal carries no numbers.
//
// ⭐ WHAT IS UNAFFECTED, deliberately: ordinary indexing, every present-tense graph query, and the
// PURE `buildDigest` / `computeDelta` pair, which remain exported and fully tested. What was
// withdrawn is permission to compare DEPLOYED history, not the algorithm that would compare it.
//
// ⚠ STORED ROWS ARE PRESERVED AND NOT PROMOTED. Nothing here deletes a digest, and no table was
// added to label one "unverified" — that would be building a system to avoid saying unavailable.
//
// ⚠ AND THE JOIN'S IMPLEMENTATION IS NOT LOST, it is in git history at 2a989822 and earlier. It is
// removed rather than left unreachable behind a flag, because a body that cannot execute is the
// third dead-code shape this repository already refuses to ship.
//
// ⇒ RESTORING THIS NEEDS A SOURCE-ATTRIBUTION PATH — comparing observations derived from immutable
// committed inputs, with the extraction, scope and evidence basis identified. That is a new input
// and publication path, not a smaller guard, and it is a scope decision rather than a repair.

/**
 * Why a commit-to-commit comparison cannot be served.
 *
 * One definition, so the API, the dashboard and the documentation cannot drift apart about it.
 */
export const SOURCE_ATTRIBUTION_UNAVAILABLE =
  'structural history is withdrawn: a stored digest cannot be attributed to the source its named '
  + 'commit contained. The indexer parses the working tree and carries unchanged rows forward, so a '
  + 'digest can describe bytes that commit never held — reproduced with a clean tree at both ends of '
  + 'the run and an unmoved HEAD. Indexing and present-tense graph queries are unaffected.';

/** A refusal carries no delta. Handing back numbers beside "I cannot compare these" invites their use. */
function unavailable(reason, fromCommit = null, toCommit = null) {
  return {
    available: false, reason, fromCommit, toCommit, requestedCommit: toCommit, note: null, delta: null,
  };
}

/**
 * The delta between two commits — REFUSED while source attribution is unavailable.
 *
 * @returns {{available: false, reason: string, fromCommit: string|null, toCommit: string|null, delta: null}}
 */
export function deltaBetween(_db, { fromCommit = null, toCommit = null } = {}) {
  return unavailable(SOURCE_ATTRIBUTION_UNAVAILABLE, fromCommit, toCommit);
}

/**
 * "What changed since the last time this repository was indexed" — REFUSED for the same reason.
 *
 * ⛔ THE FALLBACK CANNOT RESCUE IT. This used to substitute the newest stored pair when HEAD had no
 * digest, which is the right move when the only problem is a missing row. It cannot help when NO
 * pair has attribution: a substitution would answer a different question with the same unsupported
 * evidence.
 */
export function deltaFromPrevious(_db, { toCommit = null } = {}) {
  return unavailable(SOURCE_ATTRIBUTION_UNAVAILABLE, null, toCommit);
}
