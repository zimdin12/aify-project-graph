// Opt-in switch: when APG_AUTO_REINDEX is truthy, the MCP dispatch self-heals a
// stale graph (incremental ensureFresh) BEFORE running a read verb, so managed
// workers — who get the read verbs but cannot call graph_index — stop getting
// false-empty results from a behind-HEAD graph. OFF by default (no surprise
// latency); warn-by-default behavior is unchanged when this is off.
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
export function autoReindexEnabled(value) {
  return typeof value === 'string' && TRUTHY.has(value.trim().toLowerCase());
}
