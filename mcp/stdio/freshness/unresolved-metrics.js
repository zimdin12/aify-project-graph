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
    rule:
      'An unresolved edge is TRUST-RELEVANT unless it is a CONTAINS relation, or classifies as '
      + 'external-by-design (the target genuinely lives outside this repo), shape-issue (the reference '
      + 'is not resolvable in principle), or denylisted-by-design (generic names like parse/log/__dirname). '
      + 'None of those are fixable resolution gaps, so counting them made the trust banner read worse '
      + 'than reality. The rule is published here so a small denominator is distinguishable from a hidden one.',
  };
}
