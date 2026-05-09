export const RANKING_ORDER = ['changed_files', 'task_anchors', 'code_intel_confidence', 'recency'];

export const DEFAULT_CAPS = {
  evidence_records: 12,
  diagnostics: 10,
  affected_files: 12,
  read_first: 10,
  refs_per_symbol: 8
};

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function score(item, key) {
  const v = item?.score?.[key];
  if (v === undefined || v === null) return 0;
  if (key === 'code_intel_confidence') return CONFIDENCE_RANK[v] || 0;
  return typeof v === 'number' ? v : (v ? 1 : 0);
}

export function rankAndCap(items, limit) {
  const arr = Array.isArray(items) ? [...items] : [];
  arr.sort((a, b) => {
    for (const key of RANKING_ORDER) {
      const sa = score(a, key);
      const sb = score(b, key);
      if (sa !== sb) return sb - sa;
    }
    return 0;
  });
  return Number.isFinite(limit) ? arr.slice(0, limit) : arr;
}
