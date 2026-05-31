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
    operations,
    collectedAt: row.collected_at,
    importedAt: row.imported_at,
    mode: row.mode ?? sess.mode ?? null,
    indexReady,
    indexWaitMs: row.index_wait_ms ?? sess.indexWaitMs ?? null,
    refsFound: row.refs_found ?? sess.refsFoundSymbols ?? null,
    refsNotFound: row.refs_not_found ?? sess.refsNotFoundSymbols ?? null,
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
  const definitions = rows.filter((r) => r.kind === 'definition').map(rowToRecord);
  const references = rows.filter((r) => r.kind === 'reference').map(rowToRecord);
  const hovers = rows.filter((r) => r.kind === 'hover').map(rowToRecord);
  return {
    found: definitions.length > 0 || references.length > 0,
    definitions,
    references,
    hovers,
    summary: { definitions: definitions.length, references: references.length, hovers: hovers.length },
  };
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
