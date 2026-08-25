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

function parseExtra(row) {
  if (!row) return {};
  if (typeof row.extra === 'string') {
    try {
      return JSON.parse(row.extra);
    } catch {
      return {};
    }
  }
  return row.extra ?? {};
}

function canonicalSymbolKey(row) {
  const extra = parseExtra(row);
  const qparts = normalizeQname(extra?.qname ?? '');
  if (qparts.length > 0) return `${row.type ?? 'Symbol'}:${qparts.join('.')}`;

  const parentClass = normalizeQualifiedPart(extra?.parent_class ?? '');
  if (parentClass) return `${row.type ?? 'Symbol'}:${parentClass}.${row.label ?? ''}`;

  return `${row.type ?? 'Symbol'}:${row.label ?? ''}:${row.file_path ?? ''}`;
}

function displaySymbolCandidate(row) {
  const extra = parseExtra(row);
  const qparts = normalizeQname(extra?.qname ?? '');
  if (qparts.length > 0) return qparts.join('::');

  const parentClass = normalizeQualifiedPart(extra?.parent_class ?? '');
  if (parentClass) return `${parentClass}::${row.label}`;

  return row.label ?? '(unknown)';
}

function candidateSortKey(a, b) {
  const confidenceDelta = (b.confidence ?? 0) - (a.confidence ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  const fileDelta = (a.file_path ?? '').localeCompare(b.file_path ?? '');
  if (fileDelta !== 0) return fileDelta;
  return (a.start_line ?? 0) - (b.start_line ?? 0);
}

// ⛔ THE COUNT IN THIS MESSAGE WAS THE RETRIEVAL LIMIT AGAIN — third instance of one class.
//
// review, hermes session, with 60 definitions: "AMBIGUOUS MATCH … 50 concrete candidates
// found". `rows` is the page resolveSymbol returned, and that query ends LIMIT 50, so
// `groups.size` counts identities among the FIRST FIFTY and reports it as the population.
//
// ★ This is the path I moved the contract ONTO after deleting the dead structured fields,
// so the replacement reproduced the very defect it replaced. The class survives being
// fixed because each fix lands one layer away from where the cap actually is.
//
// ⇒ `rowsTotal` is the uncapped COUNT of matching rows. Grouping is only possible over
// what was retrieved, so the honest statement is NOT a corrected number — it is a stated
// uncertainty: at least G identities among 50 of 60 rows, population not established.
// Inventing a group count for rows nobody grouped would be the same lie in the other
// direction.
export function buildAmbiguousMatchMessage(symbol, rows, limit = 5, rowsTotal = null) {
  if (!symbol) return null;

  const concrete = preferConcrete(rows);
  if (concrete.length <= 1) return null;

  // Group by canonical definition identity (qname / parent-class+label / file).
  // Overloads and the C++ decl/def split share a canonical key → one group →
  // not ambiguous. Genuinely distinct definitions (e.g. `Foo::bar` living in two
  // namespaces) form separate groups.
  const groups = new Map();
  for (const row of concrete) {
    const key = canonicalSymbolKey(row);
    const existing = groups.get(key);
    if (existing) {
      if ((row.confidence ?? 0) > (existing.confidence ?? 0)) groups.set(key, row);
      continue;
    }
    groups.set(key, row);
  }

  if (groups.size <= 1) return null;

  // C6 fix: do NOT blanket-skip qualified symbols. The old guard returned early
  // whenever the input contained `::`/`.`, assuming the qualifier disambiguated
  // — but a class-qualified name can STILL resolve to multiple distinct
  // definitions (same class name in two namespaces, suffix-matched qnames).
  // Skipping the guard there let graph_impact/graph_callers silently UNION every
  // matching definition's blast radius (overstated impact, dishonest trust
  // banner). We now flag whenever >1 distinct definition survives, regardless of
  // qualification, and tailor the retry hint: if the caller already qualified,
  // tell them class-qualification was not enough — narrow harder.
  const qualified = QUALIFIER_RE.test(symbol);
  const candidates = [...groups.values()]
    .sort(candidateSortKey)
    .slice(0, limit)
    .map((row) => `- ${displaySymbolCandidate(row)} ${row.file_path}:${row.start_line ?? 0}`);

  // ★ AMBIGUITY ACROSS LANGUAGES IS A FINDING, NOT A FAILURE TO DISAMBIGUATE.
  //
  // When the candidates span different LANGUAGES, "this symbol exists twice, in two
  // languages, with nothing linking them" is frequently the answer the caller
  // actually wanted — and we were modelling it as an error, printing it as a
  // refusal, and then answering the qualified retry without ever mentioning the twin
  // we had just listed.
  //
  // Measured (the field test, 2026-07-31). Asked what shader code must change in lockstep
  // with a C++ header, graph_consequences returned exactly the two candidates —
  // worldbuf.glsl:243 and CylindricalPosition.h:110 — as an AMBIGUOUS MATCH error.
  // That pair WAS the answer. He found the real bug by hand: the GLSL copy hardcodes
  // 32.0 where C++ uses CHUNK_SIZE, so changing the constant silently desyncs the GPU.
  //
  // His framing, which is why this is worth fixing rather than tuning: the filler
  // suggestion manufactured a signal that was not there; this DISCARDS a signal that
  // is. Both are framing bugs, not data bugs — the data was right both times.
  const languages = new Set(
    [...groups.values()].map((r) => String(r.language || '').toLowerCase()).filter(Boolean),
  );
  const crossLanguage = languages.size > 1;

  const retryHint = qualified
    ? 'These are DISTINCT definitions (same name, different namespace/file) — class qualification did not disambiguate. Add more namespace qualification (Namespace::Class::method) or query one file to avoid overstating impact.'
    : 'Retry with a qualified symbol (Class::method / Namespace::Class::method) or use a file-specific query.';

  const crossLanguageNote = crossLanguage
    ? [
      '',
      `★ CROSS-LANGUAGE DUPLICATE — this name is defined in ${languages.size} languages (${[...languages].join(', ')}).`,
      'That is usually a FINDING rather than a disambiguation problem: the same logic exists twice with no edge',
      // ★ WAS: "and nothing will fail if they drift apart." STATIC TEXT — an
      // unevidenced universal negative about test coverage, printed regardless of
      // whether any test was looked for. the field test asked directly whether it was
      // conditioned on anything; it was not. It happened to be true for the symbol
      // he checked, which is exactly how a static claim survives: it is only ever
      // read next to cases where it holds.
      //
      // What IS established here is the absence of a graph EDGE between the copies.
      // Whether a test would catch the drift is a separate question this function
      // never asked, so it no longer answers it.
      'linking the copies, so a change to one does NOT propagate through the graph. Whether any TEST would catch',
      'the drift is not established here — this checks for an edge, not for coverage; call graph_consequences on',
      'each copy and read tests_adjacent WITH its provenance before assuming either is unguarded.',
      'Check the copies for hardcoded literals that mirror a named constant on the other side — that is where',
      'silent desync lives. If you meant one specific copy, qualify or pass file= to scope the query.',
    ].join('\n')
    : '';

  // ★ THE LIST IS CAPPED. SAY SO — THE ONE THEY WANT MAY BE IN THE MISSING PART.
  //
  // Measured (the field test, echoes, 2026-08-10). `GpuMaterial` printed
  // "16 concrete candidates found:" and then FIVE bullets, all GLSL, and stopped.
  // No "11 more", no truncated flag, no limit. Ground truth by rg: exactly 16
  // definitions — 1 C++ (engine/rendering/GpuMaterialPalette.h:30) and 15 GLSL.
  //
  // The single C++ declaration — the one a caller almost always means — was inside
  // the silent eleven. A reader takes "16 found:" followed by a list as the list,
  // and this one both understated itself and omitted the answer.
  //
  // His framing, and it is the right priority: ranking C++ first is a nice-to-have,
  // disclosing the cap is the CORRECTNESS fix. A ranking tells you the order is
  // unreliable and you must still go looking; a truncation marker tells you the
  // LIST IS INCOMPLETE, which is a different and load-bearing claim.
  //
  // The idiom already exists in this codebase — documents_mentioning_note,
  // co_consumer_files {items,total,truncated,limit}. It was simply never applied
  // here.
  const omitted = groups.size - candidates.length;
  const truncationNote = omitted > 0
    ? `  ⚠ SHOWING ${candidates.length} OF ${groups.size} — ${omitted} candidate(s) omitted. `
      + 'The definition you want may be among them: on a repo with shader or generated '
      + 'mirrors, the sole first-party declaration can fall outside this cap. '
      + `Narrow with file= or a qualified name, or use graph_whereis(symbol="${symbol}") which does not cap the same way and reports its own limit.`
    : '';

  // Retrieval was capped, so the identities below were computed from a PAGE, not from the
  // population. Say that, rather than presenting a page count as a total.
  const retrievalCapped = rowsTotal != null && rowsTotal > rows.length;
  const headline = retrievalCapped
    ? `AMBIGUOUS MATCH for "${symbol}". AT LEAST ${groups.size} concrete candidates, `
      + `identified from ${rows.length} of ${rowsTotal} matching rows — the full ambiguity `
      + 'population is NOT established (retrieval was capped before grouping):'
    : `AMBIGUOUS MATCH for "${symbol}". ${groups.size} concrete candidates found:`;

  return [
    headline,
    ...candidates,
    truncationNote,
    retryHint,
    crossLanguageNote,
  ].filter(Boolean).join('\n');
}

// Try an exact label match first, then a class-qualified fallback.
// `typesClause` is the SQL fragment used inside IN (...) — callers pass
// their own set (whereis and preflight include Test, path uses all nodes).
// ⛔ THE RETRIEVAL CAP IS NOT THE POPULATION, AND IT WAS BEING REPORTED AS ONE.
//
// Found by review, hermes session reviewing my own fix for this exact class. I had made
// graph_packet say "showing 3 of N" instead of printing the cap as a total — but N came
// from `resolveSymbol().length`, and every query below is `LIMIT 50`. Their probe: insert
// 60 same-label nodes, ask the packet, get "showing 3 of 50". The number I introduced to
// FIX a cap-as-total defect was itself a cap reported as a total, one level upstream.
//
// ⇒ resolveSymbolWithTotal runs a COUNT over the SAME predicate as the stage that actually
// matched, so the total is the population and the rows stay bounded. The count is skipped
// entirely when the page came back short, which is the common case — a short page IS the
// population, and that is knowable without asking.
//
// `resolveSymbol` keeps its exact signature and behaviour; every existing caller is
// unaffected.
export function resolveSymbol(db, symbol, typesClause = null) {
  return resolveSymbolWithTotal(db, symbol, typesClause).rows;
}

const RESOLVE_LIMIT = 50;

// ⛔ AN EXACT TOTAL PAIRED WITH A SAMPLED COMPOSITION IS STILL A CAP REPORTED AS A FINDING.
//
// `resolveFeatureForSymbolCheap` had the UNCAPPED total (via the COUNT below) but computed its
// language census from the 50-row page. review, hermes session's probe: 60 definitions, first
// 50 C++ and last 10 GLSL, produced
//     DEFINED IN ... showing 3 of 60
//     PARSED 60 BY LANGUAGE: cpp 50
// and NO CROSS-LANGUAGE DUPLICATE — the second language existed only beyond the retrieval page,
// so its absence from the sample SUPPRESSED the finding. An exact denominator lending its
// authority to a sampled numerator, and the suppression is worse than the wrong count.
//
// ⇒ This groups over the UNCAPPED predicate. It deliberately covers only the exact-label
// predicate — the first and dominant path in resolveSymbolWithTotal. When the resolver settled
// on a qname or by-name predicate instead, this returns null and the caller must label its
// composition SAMPLED rather than silently reuse a census built from a different population.
export function languageCensusExact(db, symbol, typesClause = null) {
  if (!symbol) return null;
  const typeFilter = typesClause ? `AND type IN (${typesClause})` : '';
  try {
    const rows = db.all(
      `SELECT COALESCE(NULLIF(language, ''), 'unknown') AS lang, COUNT(*) AS n
         FROM nodes WHERE label = $label ${typeFilter}
        GROUP BY lang ORDER BY n DESC`,
      { label: symbol },
    );
    if (!rows.length) return null;
    return rows.map((r) => ({ lang: r.lang, count: r.n }));
  } catch { return null; }
}

export function resolveSymbolWithTotal(db, symbol, typesClause = null) {
  if (!symbol) return { rows: [], total: 0, truncated: false };
  const typeFilter = typesClause ? `AND type IN (${typesClause})` : '';
  // A full page cannot establish the population, so it is the only case that pays for a
  // COUNT. A short page is its own total.
  const settle = (rows, countSql, params) => {
    if (rows.length < RESOLVE_LIMIT) return { rows, total: rows.length, truncated: false };
    const total = db.get(countSql, params)?.n ?? rows.length;
    return { rows, total, truncated: total > rows.length };
  };

  const exact = db.all(
    `SELECT * FROM nodes WHERE label = $label ${typeFilter} LIMIT 50`,
    { label: symbol },
  );
  if (exact.length > 0 || !QUALIFIER_RE.test(symbol)) {
    return settle(exact, `SELECT COUNT(*) AS n FROM nodes WHERE label = $label ${typeFilter}`, { label: symbol });
  }

  const { parent, name } = splitQualifiedSymbol(symbol);
  if (!name) return { rows: exact, total: exact.length, truncated: false };

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
  if (qnameHits.length > 0) {
    const settled = settle(qnameHits,
      `SELECT COUNT(*) AS n FROM nodes WHERE (json_extract(extra, '$.qname') = $qname
         OR json_extract(extra, '$.qname') LIKE $qnameSuffix) ${typeFilter}`,
      { qname: dotted, qnameSuffix: `%.${dotted}` });
    return { ...settled, rows: preferConcrete(qnameHits) };
  }

  const byName = db.all(
    `SELECT * FROM nodes WHERE label = $label ${typeFilter} LIMIT 50`,
    { label: name },
  );
  const byNameSettled = settle(byName,
    `SELECT COUNT(*) AS n FROM nodes WHERE label = $label ${typeFilter}`, { label: name });
  if (byName.length === 0 || !parent) return byNameSettled;

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
  return {
    ...byNameSettled,
    rows: matchingParent.length > 0 ? preferConcrete(matchingParent) : preferConcrete(byName),
  };
}
