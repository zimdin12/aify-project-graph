// Repo-size-aware TOKEN budget for graph_packet (sibling to source-bundle.js's
// LINE budget for graph_explore/graph_trace). A fixed budget starves big repos:
// a god-file gets truncated and the agent re-Reads it — the exact fallback we
// want to kill. codegraph's load-bearing invariant: caps NEVER shrink as the
// repo grows. assertMonotonicPacketTiers() enforces it at load + in a unit test.

// ⛔ THE TOKEN-ESTIMATION DIVISOR LIVES HERE, WITH THE BUDGET CONCEPT THAT OWNS IT.
//
// It began as a private const in `packet-input.js` while `packet-lists.js` carried its own bare
// literal `4`. The obvious repair — export it from packet-input — made the SEALED list authority
// import the heavy input island (filesystem, git, database, freshness, storage) to share one
// number, reversing the intended dependency direction and widening an island's public surface.
// the reviewer measured the cost: importing `packet-lists.js` went to ~296 ms.
//
// ⇒ This module imports NOTHING. A constant two authorities share belongs in the neutral thing
// they both already depend on, not in whichever of them happened to declare it first.
export const CHAR_PER_TOKEN_EST = 4; // rough; matches our existing brief-budget heuristic

export const PACKET_TIERS = [
  { name: 'tiny',   maxNodes: 800,      budgetTokens: 1500,  caps: { evidence_records: 12, affected_files: 12, read_first: 10, diagnostics: 10, refs_per_symbol: 8 } },
  { name: 'small',  maxNodes: 4000,     budgetTokens: 2800,  caps: { evidence_records: 16, affected_files: 16, read_first: 12, diagnostics: 12, refs_per_symbol: 8 } },
  { name: 'medium', maxNodes: 15000,    budgetTokens: 4500,  caps: { evidence_records: 20, affected_files: 20, read_first: 14, diagnostics: 14, refs_per_symbol: 10 } },
  { name: 'large',  maxNodes: 40000,    budgetTokens: 7000,  caps: { evidence_records: 26, affected_files: 26, read_first: 18, diagnostics: 16, refs_per_symbol: 12 } },
  { name: 'huge',   maxNodes: Infinity, budgetTokens: 10000, caps: { evidence_records: 32, affected_files: 32, read_first: 22, diagnostics: 18, refs_per_symbol: 14 } },
];

const CAP_AXES = ['evidence_records', 'affected_files', 'read_first', 'diagnostics', 'refs_per_symbol'];

// Throw at load (and in a test) if any larger tier has a SMALLER cap than a
// smaller tier on any axis — fail loud, never silently starve a big repo.
export function assertMonotonicPacketTiers(tiers = PACKET_TIERS) {
  for (let i = 1; i < tiers.length; i += 1) {
    const prev = tiers[i - 1];
    const cur = tiers[i];
    if (cur.budgetTokens < prev.budgetTokens) {
      throw new Error(`packet tier monotonicity violated: ${cur.name}.budgetTokens=${cur.budgetTokens} < ${prev.name}.budgetTokens=${prev.budgetTokens}`);
    }
    for (const axis of CAP_AXES) {
      if (cur.caps[axis] < prev.caps[axis]) {
        throw new Error(`packet tier monotonicity violated: ${cur.name}.caps.${axis}=${cur.caps[axis]} < ${prev.name}.caps.${axis}=${prev.caps[axis]}`);
      }
    }
  }
  return true;
}
assertMonotonicPacketTiers();

// Pick the token budget + caps for a node count. Non-finite/negative → tiny
// (the safest under-read). Returns a fresh object (callers may mutate caps).
export function getPacketTokenBudget(nodeCount = 0) {
  const n = Number.isFinite(nodeCount) && nodeCount > 0 ? nodeCount : 0;
  for (const tier of PACKET_TIERS) {
    if (n <= tier.maxNodes) return { name: tier.name, budgetTokens: tier.budgetTokens, caps: { ...tier.caps } };
  }
  const last = PACKET_TIERS[PACKET_TIERS.length - 1];
  return { name: last.name, budgetTokens: last.budgetTokens, caps: { ...last.caps } };
}
