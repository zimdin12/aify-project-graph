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

function stripTemplateArgs(value) {
  let depth = 0;
  let out = '';
  for (const ch of value) {
    if (ch === '<') {
      depth += 1;
      continue;
    }
    if (ch === '>') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

function normalizeQualifiedPart(value) {
  if (typeof value !== 'string') return '';
  const stripped = stripTemplateArgs(value.trim());
  const pieces = stripped.split(/::|\./).map((part) => part.trim()).filter(Boolean);
  return pieces.at(-1) ?? '';
}

function normalizeQname(qname) {
  return String(qname || '')
    .split('.')
    .map(normalizeQualifiedPart)
    .filter(Boolean);
}

function preferConcrete(rows) {
  const concrete = rows.filter((row) => row.type !== 'External');
  return concrete.length > 0 ? concrete : rows;
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

  const dotted = symbol.replace(/::/g, '.');
  const qnameHits = db.all(
    `SELECT * FROM nodes
     WHERE (
       json_extract(extra, '$.qname') = $qname
       OR json_extract(extra, '$.qname') LIKE $qnameSuffix
     ) ${typeFilter}
     LIMIT 50`,
    { qname: dotted, qnameSuffix: `%.${dotted}` },
  );
  if (qnameHits.length > 0) return preferConcrete(qnameHits);

  const byName = db.all(
    `SELECT * FROM nodes WHERE label = $label ${typeFilter} LIMIT 50`,
    { label: name },
  );
  if (byName.length === 0 || !parent) return byName;

  // Disambiguate by parent class when multiple rows share the bare name.
  // Uses both parent_class and qname suffixes, but normalizes template and
  // namespace decoration so `Foo<T>::bar`, `ns::Foo::bar`, and a stripped
  // stored qname still converge on the same method rows.
  const parentBare = normalizeQualifiedPart(parent);
  const matchingParent = byName.filter((row) => {
    try {
      const extra = typeof row.extra === 'string' ? JSON.parse(row.extra) : row.extra;
      const parentClass = normalizeQualifiedPart(extra?.parent_class ?? '');
      if (parentClass && parentClass === parentBare) return true;
      const qparts = normalizeQname(extra?.qname ?? '');
      return qparts.length >= 2 && qparts[qparts.length - 2] === parentBare;
    } catch {
      return false;
    }
  });
  return matchingParent.length > 0 ? preferConcrete(matchingParent) : preferConcrete(byName);
}
