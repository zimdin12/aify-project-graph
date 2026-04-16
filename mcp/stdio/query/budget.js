export function estimateTokens(text) {
  return Math.ceil((text?.length ?? 0) / 4);
}

export function enforceBudget(edges, maxEdges) {
  const sorted = [...edges].sort((a, b) => {
    const c = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (c !== 0) return c;
    return (a.depth ?? 0) - (b.depth ?? 0);
  });
  const kept = sorted.slice(0, maxEdges);
  return { kept, dropped: edges.length - kept.length };
}
