// Canonical code-intel query helpers consumed by graph_pull, graph_change_plan,
// graph_health, and (Plan #4) the v2 packet + verify mode. Reads from
// code_intel_records (record-level evidence) and code_intel_collections
// (per-collection freshness/status).

function rowToRecord(row) {
  let raw = {};
  try { raw = JSON.parse(row.raw); } catch { /* ignore */ }
  return {
    kind: row.kind,
    language: row.language,
    symbolId: row.symbol_id,
    qname: row.qname,
    file: row.file,
    range: raw.range,
    confidence: row.confidence,
    provenance: row.provenance,
    result_state: row.result_state,
    collectionId: row.collection_id,
    raw,
  };
}

export function getLatestCollection(db, opts = {}) {
  const lang = opts.language;
  const sql = lang
    ? `SELECT * FROM code_intel_collections WHERE language=$lang ORDER BY collected_at DESC LIMIT 1`
    : `SELECT * FROM code_intel_collections ORDER BY collected_at DESC LIMIT 1`;
  const row = lang ? db.get(sql, { lang }) : db.get(sql);
  if (!row) return null;
  let operations = {};
  try { operations = JSON.parse(row.operations_json || '{}'); } catch { /* ignore */ }
  // FIX A/B — readiness + reference-outcome signals. Prefer the dedicated
  // columns; fall back to operations._session (graphs that predate the
  // columns but were written by the new importer). NULL/undefined → unknown.
  const sess = operations._session || {};
  const colReady = row.index_ready;
  const indexReady = colReady == null
    ? (sess.indexReady == null ? null : !!sess.indexReady)
    : colReady === 1;
  return {
    collectionId: row.collection_id,
    provider: row.provider,
    providerVersion: row.provider_version,
    projectRoot: row.project_root,
    language: row.language,
    status: row.status,
    freshnessBasis: row.freshness_basis,
    freshnessValue: row.freshness_value,
    compileDbHash: row.compile_db_hash,
    indexedCommit: row.indexed_commit,
    // ⛔ SCOPE. Column first, `operations._session` as the fallback for graphs written by the new
    // importer before the columns existed — the same pattern as indexReady above. NULL stays NULL:
    // a collection that did not record its coverage has UNKNOWN coverage, and unknown must not be
    // resolvable to a number a consumer can compute a ratio from.
    filesProcessed: row.files_processed ?? sess.filesProcessed ?? null,
    filesInScope: row.files_in_scope ?? sess.filesTotal ?? null,
    filesEligible: row.files_eligible ?? sess.filesEligible ?? null,
    operations,
    collectedAt: row.collected_at,
    importedAt: row.imported_at,
    mode: row.mode ?? sess.mode ?? null,
    indexReady,
    indexWaitMs: row.index_wait_ms ?? sess.indexWaitMs ?? null,
    refsFound: row.refs_found ?? sess.refsFoundSymbols ?? null,
    refsNotFound: row.refs_not_found ?? sess.refsNotFoundSymbols ?? null,
    // ★ THE SPLIT. refsNotFound is the TOTAL and must never be read as "symbols
    // with no callers" — measured on echoes 2026-08-02, 833 of 833 not-found
    // results were `definition_only` and ZERO were clean absences. A "no
    // references" statistic that includes degraded results is not a floor, it is
    // a wrong number pointing the wrong way.
    refsDegraded: row.refs_degraded ?? sess.refsDegradedSymbols ?? null,
    refsCleanNotFound: row.refs_clean_not_found ?? sess.refsCleanNotFoundSymbols ?? null,
    // WHAT WAS NEVER ASKED. A coverage percentage is verified edges over total
    // edges, so a symbol we DECLINED to query (identifier column unlocatable, or a
    // hub whose reference set hit the cap) sits in the denominator and can never
    // reach the numerator. Without these two, the percentage reads as a rate when
    // it is a FLOOR, and "not asked" is indistinguishable from "asked, found
    // nothing" — different states, only one of which is evidence about the code.
    // The not-found population BY SYMBOL KIND — benign kinds (field, enum member,
    // namespace) vs kinds that should have callers. Emitted by the provider since it
    // was written; never carried past the importer until 2026-08-02.
    refsNotFoundByKind: sess.refsNotFoundByKind ?? null,
    positionGuessSkipped: sess.positionGuessSkipped ?? null,
    refsTruncatedSymbols: sess.refsTruncatedSymbols ?? null,
    positionGuesses: sess.positionGuesses ?? null,
  };
}

export function getCodeIntelEvidenceForSymbol(db, { qname, symbolId } = {}) {
  if (!qname && !symbolId) {
    return { found: false, definitions: [], references: [], hovers: [], summary: { definitions: 0, references: 0, hovers: 0 } };
  }
  // Build named-parameter OR clause; better-sqlite3 ignores unused names so
  // we can pass both unconditionally when provided.
  const conditions = [];
  const params = {};
  if (symbolId) { conditions.push('symbol_id = $symbolId'); params.symbolId = symbolId; }
  if (qname) { conditions.push('qname = $qname'); params.qname = qname; }
  const where = conditions.join(' OR ');
  const rows = db.all(`SELECT * FROM code_intel_records WHERE ${where}`, params);
  const { kept, supersededDropped, spannedCollections } = supersedeByFile(db, rows);
  const definitions = kept.filter((r) => r.kind === 'definition').map(rowToRecord);
  const references = kept.filter((r) => r.kind === 'reference').map(rowToRecord);
  const hovers = kept.filter((r) => r.kind === 'hover').map(rowToRecord);
  return {
    found: definitions.length > 0 || references.length > 0,
    definitions,
    references,
    hovers,
    // Disclosed, not silent: how many older-generation records were dropped, and whether this
    // symbol's evidence spanned more than one collection at all.
    supersededDropped,
    spannedCollections,
    summary: { definitions: definitions.length, references: references.length, hovers: hovers.length },
  };
}

/**
 * Keep only the NEWEST collection's records FOR EACH FILE.
 *
 * ⛔ THE DEFECT THIS CLOSES. A repo accumulates one row per collection run, and this query had no
 * collection filter and no recency order — so a symbol touched by two runs returned BOTH
 * generations merged, with nothing telling the caller. Measured on this repo, 2026-08-25:
 * 6 collections, 99 files spanning more than one, and **1,170 of 7,082 symbols (16.5%)** returning
 * mixed-generation evidence. That is the CONSUMER-side number; the store-side figure ("98 files,
 * <=22.8% of records") describes what is on disk, not what anyone is handed.
 *
 * ⚠ PER FILE, NEVER GLOBALLY, AND THAT DISTINCTION IS THE WHOLE DESIGN. Filtering to the single
 * newest collection would delete every record for a file that run did not touch — and a partial
 * collection is the normal case here (the newest covered 73 files of 632). That would turn stale
 * evidence into ABSENT evidence, manufacturing the exact confident-empty-result defect this
 * codebase spent 2026-08-25 removing. Superseding per file cannot empty a file that has evidence.
 */
function supersedeByFile(db, rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return { kept: rows || [], supersededDropped: 0, spannedCollections: 1 };
  }
  const collectionIds = [...new Set(rows.map((r) => r.collection_id).filter(Boolean))];
  if (collectionIds.length <= 1) {
    return { kept: rows, supersededDropped: 0, spannedCollections: collectionIds.length || 1 };
  }
  // Recency comes from the collections table, not from the id string: an id is not an ordering.
  const order = new Map();
  try {
    const placeholders = collectionIds.map((_, i) => `$c${i}`).join(',');
    const p = Object.fromEntries(collectionIds.map((id, i) => [`c${i}`, id]));
    for (const row of db.all(
      `SELECT collection_id, collected_at FROM code_intel_collections WHERE collection_id IN (${placeholders})`, p,
    )) order.set(row.collection_id, row.collected_at || '');
  } catch {
    // Cannot establish recency ⇒ supersede nothing. Fail OPEN here on purpose: keeping a stale
    // record shows the caller too much, dropping a current one shows too little, and only the
    // second can be mistaken for an absence.
    return { kept: rows, supersededDropped: 0, spannedCollections: collectionIds.length };
  }
  const newestPerFile = new Map();
  for (const r of rows) {
    const at = order.get(r.collection_id) ?? '';
    const cur = newestPerFile.get(r.file);
    if (cur === undefined || at > cur) newestPerFile.set(r.file, at);
  }
  const kept = rows.filter((r) => (order.get(r.collection_id) ?? '') === newestPerFile.get(r.file));
  return { kept, supersededDropped: rows.length - kept.length, spannedCollections: collectionIds.length };
}

export function getCodeIntelDiagnosticsForFiles(db, files) {
  if (!files || files.length === 0) return [];
  const params = {};
  const placeholders = files.map((f, i) => {
    const k = `f${i}`;
    params[k] = f;
    return `$${k}`;
  }).join(',');
  const rows = db.all(
    `SELECT * FROM code_intel_records WHERE kind='diagnostic' AND file IN (${placeholders}) ORDER BY range_start_line`,
    params,
  );
  return rows.map(rowToRecord);
}
