export const TRUST_EXCLUDED_RELATIONS = new Set(['CONTAINS']);

export function countTrustRelevantDirtyEdges(dirtyEdges = []) {
  if (!Array.isArray(dirtyEdges) || dirtyEdges.length === 0) return 0;
  return dirtyEdges.reduce(
    (count, ref) => (TRUST_EXCLUDED_RELATIONS.has(ref?.relation) ? count : count + 1),
    0,
  );
}

export function getUnresolvedCounts(manifest = {}) {
  const total = manifest?.dirtyEdgeCount ?? (manifest?.dirtyEdges ?? []).length ?? 0;
  const trust = manifest?.trustDirtyEdgeCount ?? total;
  return { total, trust };
}
