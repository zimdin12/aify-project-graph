import { lspPriority } from './rank.js';

export function estimateTokens(text) {
  return Math.ceil((text?.length ?? 0) / 4);
}

export function enforceBudget(edges, maxEdges) {
  const sorted = [...edges].sort((a, b) => {
    // LSP_VERIFIED (clangd ground truth) is never the first thing dropped
    // under budget — it outranks heuristic edges regardless of confidence
    // (Code-Intel v2 / L2b). Heuristic edges are still kept; they just fall
    // into the drop tail before any verified edge does.
    const v = lspPriority(b) - lspPriority(a);
    if (v !== 0) return v;
    const c = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (c !== 0) return c;
    return (a.depth ?? 0) - (b.depth ?? 0);
  });
  const kept = sorted.slice(0, maxEdges);
  return { kept, dropped: edges.length - kept.length };
}
