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

// Callees are not callers reversed. "Who calls X" is a set — order is a ranking
// question. "What does X call" is a SEQUENCE: the agent is reading a function
// body and wants the calls in the order they occur, the way they would reading
// the source.
//
// rankCallees used to be a literal alias of rankCallers, and for a callee list
// every one of that function's tiebreakers is constant: depth is 1 at the
// default, fan_in is hardcoded to 1 by the caller, from_type is always
// 'Function'. All tiers collapsed, the sort fell through to arbitrary SQL row
// order, and the output read as scrambled/alphabetical (field report). Ordering
// by call-site line makes it both meaningful AND deterministic.
export function rankCallees(edges) {
  return [...edges].sort((a, b) => {
    // Ground truth still outranks heuristics — an LSP-verified callee is not
    // interleaved with guesses just because it appears later in the body.
    const v = lspPriority(b) - lspPriority(a);
    if (v !== 0) return v;
    const d = (a.depth ?? 1) - (b.depth ?? 1);
    if (d !== 0) return d;
    // Call-site order within the body. `call_line` is the line of the CALL, not
    // of the callee's definition — the two were conflated before, which is why
    // ordering could not reflect the body at all.
    const l = (a.call_line ?? Number.MAX_SAFE_INTEGER) - (b.call_line ?? Number.MAX_SAFE_INTEGER);
    if (l !== 0) return l;
    return String(a.to_label ?? '').localeCompare(String(b.to_label ?? ''));
  });
}

// Shared LSP-verified priority. 1 for clangd ground-truth edges, 0 otherwise.
// Used by rank.js (ordering) and budget.js (drop-order) so verified edges sort
// first and are never the ones dropped first under a top_k budget.
export function lspPriority(edge) {
  return edge?.provenance === 'LSP_VERIFIED' ? 1 : 0;
}

function testProximity(edge) {
  return edge.from_type === 'Test' ? 1 : 0;
}
