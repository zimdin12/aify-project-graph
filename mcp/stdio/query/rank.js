export function rankCallers(edges) {
  return [...edges].sort((a, b) => {
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

function testProximity(edge) {
  return edge.from_type === 'Test' ? 1 : 0;
}
