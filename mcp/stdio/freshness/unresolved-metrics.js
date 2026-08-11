import { classifyUnresolvedRef } from './unresolved-categorization.js';

export const TRUST_EXCLUDED_RELATIONS = new Set(['CONTAINS']);

export function countTrustRelevantDirtyEdges(dirtyEdges = []) {
  if (!Array.isArray(dirtyEdges) || dirtyEdges.length === 0) return 0;
  return dirtyEdges.reduce(
    (count, ref) => {
      if (TRUST_EXCLUDED_RELATIONS.has(ref?.relation)) return count;
      const bucket = classifyUnresolvedRef(ref);
      // external-by-design / shape-issue / denylisted-by-design are all NOT
      // fixable resolution gaps, so none of them are trust-relevant (audit
      // 2026-06-12: denylisted names like parse/log/__dirname used to inflate
      // this count, making the trust banner read worse than reality).
      if (bucket.startsWith('external-by-design:')
        || bucket.startsWith('shape-issue:')
        || bucket.startsWith('denylisted-by-design:')) {
        return count;
      }
      return count + 1;
    },
    0,
  );
}

export function getUnresolvedCounts(manifest = {}) {
  const total = manifest?.dirtyEdgeCount ?? (manifest?.dirtyEdges ?? []).length ?? 0;
  const trust = manifest?.trustDirtyEdgeCount ?? total;
  return { total, trust };
}

// ★ ATTACK TEN — PUBLISH THE RULE THAT TAKES 4853 TO 402.
//
// ef-manager, and it is the same family as attack eight on a more load-bearing
// field: `trust` was computed over a FILTERED subset whose filter was not
// published. From outside you could see unresolvedEdges 4853 and
// trustUnresolvedEdges 402 and had no way to tell a small HONEST population from a
// hidden one — the exact ambiguity that made the coverage percentage meaningless.
//
// The difference, and why he was right to rate it above his own weaker candidate:
// `trust` is the single most load-bearing word in this product. It is the field
// that gates whether an agent believes anything else. It was the one number he
// took at face value for an entire engagement without asking what was underneath.
//
// The filter is defensible — these really are not fixable resolution gaps, and
// counting them made the banner read worse than reality (audit 2026-06-12). A
// defensible filter that nobody can see is still an invisible denominator.
export function explainTrustExclusions(dirtyEdges = []) {
  if (!Array.isArray(dirtyEdges) || dirtyEdges.length === 0) return null;
  const byReason = new Map();
  let counted = 0;
  for (const ref of dirtyEdges) {
    let reason = null;
    if (TRUST_EXCLUDED_RELATIONS.has(ref?.relation)) {
      reason = `relation_excluded:${ref.relation}`;
    } else {
      const bucket = classifyUnresolvedRef(ref);
      if (bucket.startsWith('external-by-design:')) reason = 'external-by-design';
      else if (bucket.startsWith('shape-issue:')) reason = 'shape-issue';
      else if (bucket.startsWith('denylisted-by-design:')) reason = 'denylisted-by-design';
    }
    if (reason) byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    else counted += 1;
  }
  return {
    total_unresolved: dirtyEdges.length,
    trust_relevant: counted,
    excluded: [...byReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
    // ★ v0.7.0 Part 1b — 475 CHARS OF INVARIANT PROSE, ON THE VERB EVERY SESSION IS TOLD
    // TO CALL FIRST.
    //
    // The old `rule` field spelled the exclusion policy out in full: byte-identical on
    // every call, every repo, forever. That is not data, it is DOCUMENTATION BEING
    // RE-TRANSMITTED PER CALL — ~132 tok paid by every session to restate something that
    // never varies.
    //
    // ⚠ NOT DELETED, AND THE DISTINCTION MATTERS. The reason the prose existed is real
    // and is preserved: *a small denominator must be distinguishable from a hidden one.*
    // Deleting it outright would have removed a doubt clause on cost grounds, which is
    // out of scope for any cut in this release.
    //
    // What replaces it is the same guarantee in the form Part 2.3 asks for — THE
    // DENOMINATOR TRAVELS IN ITS NAME. `basis` states the policy as a compact identifier,
    // `excluded` already itemises exactly what was removed and how many, and the full
    // text lives in the skill for a reader who wants the argument rather than the fact.
    //
    // A reader can still tell a small denominator from a hidden one — `excluded` is the
    // evidence and always was. The prose was the essay about the evidence.
    basis: 'trust_relevant = unresolved − (CONTAINS | external-by-design | shape-issue | denylisted-by-design)',
    basisRef: 'aify-project-graph skill § trust denominator',
  };
}
