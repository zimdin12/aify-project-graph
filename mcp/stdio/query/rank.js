export function rankCallers(edges) {
  return [...edges].sort((a, b) => {
    // LSP_VERIFIED (clangd ground truth) always ranks above heuristic edges —
    // it is never rendered or ordered as equal to a tree-sitter/heuristic edge
    // (Code-Intel v2 / L2b). This also keeps verified edges out of the
    // budget-drop tail (enforceBudget applies the same priority).
    const v = lspPriority(b) - lspPriority(a);
    if (v !== 0) return v;
    const d = (a.depth ?? 1) - (b.depth ?? 1);
    if (d !== 0) return d;
    const c = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (c !== 0) return c;
    const t = testProximity(b) - testProximity(a);
    if (t !== 0) return t;
    return (b.fan_in ?? 0) - (a.fan_in ?? 0);
  });
}

export const rankCallees = rankCallers;

// Shared LSP-verified priority. 1 for clangd ground-truth edges, 0 otherwise.
// Used by rank.js (ordering) and budget.js (drop-order) so verified edges sort
// first and are never the ones dropped first under a top_k budget.
export function lspPriority(edge) {
  return edge?.provenance === 'LSP_VERIFIED' ? 1 : 0;
}

function testProximity(edge) {
  return edge.from_type === 'Test' ? 1 : 0;
}
