// Shared symbol resolution helper that handles class-qualified input.
//
// Problem this solves: verbs store labels as the bare identifier
// (`setGravAxis`), but agents — especially on C++ — naturally ask for the
// qualified form (`GpuSimFramework::setGravAxis`, `Class.method`).
// Without normalization, graph_impact/graph_change_plan/graph_path all
// return NO MATCH on the qualified form. The echoes manager's 6-agent
// CC lean-half 2×2 (2026-04-21) measured 0-of-5 useful graph calls
// because every attempt used the qualified C++ shape.
//
// Resolution order:
//   1. Exact label match (most common, fastest).
//   2. If symbol contains `::` or `.` and step 1 is empty, split on the
//      separator and try the last component as label. If the parent
//      component looks like a class name, prefer rows whose `extra.qname`
//      starts with that parent (disambiguates same-named methods across
//      classes).
//
// Returns the row array (possibly empty) the same shape a direct
// `WHERE label = $label` query would return.

const QUALIFIER_RE = /::|\./;

export function splitQualifiedSymbol(symbol) {
  if (typeof symbol !== 'string' || !symbol) return { parent: '', name: symbol };
  // Prefer the rightmost separator so `A::B::method` gives parent=`B`.
  const lastCxx = symbol.lastIndexOf('::');
  const lastDot = symbol.lastIndexOf('.');
  const idx = Math.max(lastCxx, lastDot);
  if (idx === -1) return { parent: '', name: symbol };
  const sepLen = lastCxx > lastDot ? 2 : 1;
  return {
    parent: symbol.slice(0, idx),
    name: symbol.slice(idx + sepLen),
  };
}

// Try an exact label match first, then a class-qualified fallback.
// `typesClause` is the SQL fragment used inside IN (...) — callers pass
// their own set (whereis and preflight include Test, path uses all nodes).
export function resolveSymbol(db, symbol, typesClause = null) {
  if (!symbol) return [];
  const typeFilter = typesClause ? `AND type IN (${typesClause})` : '';

  const exact = db.all(
    `SELECT * FROM nodes WHERE label = $label ${typeFilter} LIMIT 50`,
    { label: symbol },
  );
  if (exact.length > 0 || !QUALIFIER_RE.test(symbol)) return exact;

  const { parent, name } = splitQualifiedSymbol(symbol);
  if (!name) return exact;

  const byName = db.all(
    `SELECT * FROM nodes WHERE label = $label ${typeFilter} LIMIT 50`,
    { label: name },
  );
  if (byName.length === 0 || !parent) return byName;

  // Disambiguate by parent class when multiple rows share the bare name.
  // Uses extra.qname (stored as JSON) — dot-separated in generic.js, so we
  // compare the last dot-separated segment of parent against the
  // second-to-last segment of qname.
  const parentBare = splitQualifiedSymbol(parent).name;
  const matchingParent = byName.filter((row) => {
    try {
      const extra = typeof row.extra === 'string' ? JSON.parse(row.extra) : row.extra;
      const qname = extra?.qname ?? '';
      if (!qname) return false;
      const parts = qname.split('.');
      return parts.length >= 2 && parts[parts.length - 2] === parentBare;
    } catch {
      return false;
    }
  });
  return matchingParent.length > 0 ? matchingParent : byName;
}
