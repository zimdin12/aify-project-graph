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
