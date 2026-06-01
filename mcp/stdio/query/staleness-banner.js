// ONE consistent staleness line that agents learn once: when a response includes
// files that have been edited since the graph was indexed (per read_freshness),
// prepend this so the agent Reads those files instead of trusting stale truth.
// Wording is stable so agents (and tests) can rely on it.
export function stalenessBanner(staleFiles, { max = 8 } = {}) {
  const files = Array.isArray(staleFiles) ? staleFiles.filter(Boolean) : [];
  if (!files.length) return '';
  const shown = files.slice(0, max);
  const overflow = files.length - shown.length;
  const list = shown.join(', ') + (overflow > 0 ? ` (+${overflow} more)` : '');
  return `⚠ stale: ${list} — Read these directly; the rest is fresh.`;
}
