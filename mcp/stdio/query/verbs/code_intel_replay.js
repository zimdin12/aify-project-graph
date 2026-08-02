// code_intel_replay — query parent-collected v0.2 facts without spawning
// clangd. Bounded MCP verb intended for subagents (per reference a3f0fde
// parent-session pattern): the parent runs graph_collect_code_intel,
// import lands rows in code_intel_records / code_intel_collections, and
// subagents call replay against the local DB to fetch references /
// definitions / hovers / diagnostics / symbols for a symbol or file.
//
// Reads only. Never starts an LSP client. Provenance tagged CODE_INTEL_REPLAY
// so consumers know the answer is replayed-from-collection, not live.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { openExistingDb } from '../../storage/db.js';
import { getLatestCollection } from '../../code-intel/query.js';

const VALID_KINDS = new Set(['references', 'definitions', 'hover', 'diagnostics', 'symbols', 'all']);
const KIND_MAP = {
  references: 'reference',
  definitions: 'definition',
  hover: 'hover',
  diagnostics: 'diagnostic',
  symbols: 'symbol'
};

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
    context: raw.context,
    severity: raw.severity,
    message: raw.message,
    confidence: row.confidence,
    provenance: 'CODE_INTEL_REPLAY',
    underlyingProvenance: row.provenance,
    result_state: row.result_state,
    collectionId: row.collection_id
  };
}

export async function codeIntelReplay({ repoRoot, collectionId = 'latest', symbol = null, file = null, kind = 'all', limit = 20 } = {}) {
  if (!repoRoot) {
    return { status: 'error', errors: [{ code: 'invalid_request', message: 'repoRoot is required', hint: 'this is a problem with the CALL, not the tool' }], records: [] };
  }
  if (!VALID_KINDS.has(kind)) {
    return { status: 'error', errors: [{ code: 'invalid_request', message: `invalid kind '${kind}'`, hint: `expected one of ${[...VALID_KINDS].join(', ')}` }], records: [] };
  }

  const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
  if (!existsSync(dbPath)) {
    return {
      status: 'not_collected',
      collectionId: null,
      result_state: 'not_collected',
      records: [],
      summary: {},
      provenance: 'CODE_INTEL_REPLAY',
      reason: 'no_graph_db'
    };
  }

  let db;
  try { db = openExistingDb(dbPath); }
  catch (err) {
    return { status: 'error', errors: [{ code: 'internal_error', message: err.message, hint: '' }], records: [] };
  }

  try {
    let resolvedId = collectionId;
    if (collectionId === 'latest') {
      const latest = getLatestCollection(db);
      if (!latest) {
        return {
          status: 'not_collected',
          collectionId: null,
          result_state: 'not_collected',
          records: [],
          summary: {},
          provenance: 'CODE_INTEL_REPLAY',
          reason: 'no_collection_imported'
        };
      }
      resolvedId = latest.collectionId;
    } else {
      const row = db.get(`SELECT collection_id FROM code_intel_collections WHERE collection_id = $id`, { id: collectionId });
      if (!row) {
        return {
          status: 'not_collected',
          collectionId,
          result_state: 'not_collected',
          records: [],
          summary: {},
          provenance: 'CODE_INTEL_REPLAY',
          reason: 'collection_id_not_found'
        };
      }
    }

    const conditions = ['collection_id = $cid'];
    const params = { cid: resolvedId };
    if (symbol) { conditions.push('(qname = $sym OR symbol_id = $sym)'); params.sym = symbol; }
    if (file) { conditions.push('file = $file'); params.file = file; }
    if (kind !== 'all') { conditions.push('kind = $kind'); params.kind = KIND_MAP[kind]; }
    const where = conditions.join(' AND ');
    const cappedLimit = Math.max(1, Math.min(500, (limit | 0) || 20));
    params.lim = cappedLimit;
    const sql = `SELECT * FROM code_intel_records WHERE ${where} LIMIT $lim`;
    const rows = db.all(sql, params);
    const records = rows.map(rowToRecord);

    const summary = records.reduce((acc, r) => {
      const k = r.kind === 'reference' ? 'references'
        : r.kind === 'definition' ? 'definitions'
        : r.kind === 'diagnostic' ? 'diagnostics'
        : r.kind === 'hover' ? 'hover'
        : r.kind === 'symbol' ? 'symbols'
        : 'other';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    return {
      status: 'ok',
      collectionId: resolvedId,
      result_state: records.length > 0 ? 'found' : 'not_found',
      records,
      summary,
      provenance: 'CODE_INTEL_REPLAY'
    };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
