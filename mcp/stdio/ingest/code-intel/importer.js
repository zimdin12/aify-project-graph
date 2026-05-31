import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { upsertNode } from '../../storage/nodes.js';
import { upsertEdge } from '../../storage/edges.js';
import { validateCodeIntelRecord } from './schema.js';
import { detectSchemaVersion, validateAny } from './schema.js';
import { ensureCodeIntelRecordsTable, ensureCodeIntelCollectionsTable } from '../../storage/schema.js';

function hash(parts) {
  return createHash('sha1').update(parts.join('::')).digest('hex');
}

function qnameId(qname) {
  return `ci:symbol:${hash([qname])}`;
}

function fileId(file) {
  return `file:${hash([file])}`;
}

function externalId(qname) {
  return `external:${hash([qname])}`;
}

function diagnosticId(record) {
  return `ci:diagnostic:${hash([record.file, record.start_line, record.code, record.message])}`;
}

function upsertFileNode(db, file, { language = '', confidence = 1 } = {}) {
  const id = fileId(file);
  upsertNode(db, {
    id,
    type: 'File',
    label: basename(file),
    file_path: file,
    start_line: 1,
    end_line: 1,
    language,
    confidence,
    structural_fp: '',
    dependency_fp: '',
    extra: { qname: file, code_intel: true, parent_dir: dirname(file) === '.' ? '' : dirname(file) },
  });
  return id;
}

function upsertExternalNode(db, qname, { language = '', confidence = 0.6 } = {}) {
  const id = externalId(qname);
  upsertNode(db, {
    id,
    type: 'External',
    label: qname.split(/::|\.|#/u).filter(Boolean).at(-1) ?? qname,
    file_path: '',
    start_line: 0,
    end_line: 0,
    language,
    confidence,
    structural_fp: '',
    dependency_fp: '',
    extra: { qname, code_intel: true },
  });
  return id;
}

function upsertSymbol(db, record) {
  const id = record.id || qnameId(record.qname);
  upsertFileNode(db, record.file, { language: record.language, confidence: record.confidence });
  upsertNode(db, {
    id,
    type: record.node_type,
    label: record.name,
    file_path: record.file,
    start_line: record.start_line,
    end_line: record.end_line,
    language: record.language,
    confidence: record.confidence,
    structural_fp: '',
    dependency_fp: '',
    extra: {
      qname: record.qname,
      code_intel: true,
      code_intel_schema: record.schema_version,
      symbol_kind: record.symbol_kind,
      provenance: 'CODE_INTEL',
      raw: record.raw,
    },
  });
  upsertEdge(db, {
    from_id: fileId(record.file),
    to_id: id,
    relation: 'DEFINES',
    source_file: record.file,
    source_line: record.start_line,
    confidence: record.confidence,
    provenance: 'CODE_INTEL',
    extractor: record.source || 'code-intel',
  });
  return id;
}

function upsertEndpointShell(db, endpoint, record) {
  if (endpoint.file) {
    upsertFileNode(db, endpoint.file, { language: record.language, confidence: record.confidence });
    const id = qnameId(endpoint.qname);
    const existing = db.get('SELECT id FROM nodes WHERE id = $id', { id });
    if (existing) return id;
    upsertNode(db, {
      id,
      type: 'Symbol',
      label: endpoint.name,
      file_path: endpoint.file,
      start_line: endpoint.line || 1,
      end_line: endpoint.line || 1,
      language: record.language,
      confidence: Math.min(record.confidence, 0.85),
      structural_fp: '',
      dependency_fp: '',
      extra: {
        qname: endpoint.qname,
        code_intel: true,
        inferred_shell: true,
      },
    });
    return id;
  }
  return upsertExternalNode(db, endpoint.qname, { language: record.language, confidence: Math.min(record.confidence, 0.7) });
}

function upsertEdgeLike(db, record) {
  const fromId = upsertEndpointShell(db, record.source, record);
  const toId = upsertEndpointShell(db, record.target, record);
  upsertEdge(db, {
    from_id: fromId,
    to_id: toId,
    relation: record.relation,
    source_file: record.file,
    source_line: record.start_line,
    confidence: record.confidence,
    provenance: 'CODE_INTEL',
    extractor: record.source_name || 'code-intel',
  });
}

function upsertInclude(db, record) {
  const fromId = upsertFileNode(db, record.source_file, { language: record.language, confidence: record.confidence });
  const toId = upsertFileNode(db, record.target_file, { language: record.language, confidence: record.confidence });
  upsertEdge(db, {
    from_id: fromId,
    to_id: toId,
    relation: record.relation,
    source_file: record.source_file,
    source_line: record.start_line,
    confidence: record.confidence,
    provenance: 'CODE_INTEL',
    extractor: record.source_name || 'code-intel',
  });
}

function upsertDiagnostic(db, record) {
  upsertFileNode(db, record.file, { language: '', confidence: 1 });
  const id = diagnosticId(record);
  upsertNode(db, {
    id,
    type: 'Symbol',
    label: record.code ? `${record.severity}:${record.code}` : record.severity,
    file_path: record.file,
    start_line: record.start_line,
    end_line: record.end_line,
    language: '',
    confidence: 1,
    structural_fp: '',
    dependency_fp: '',
    extra: {
      qname: id,
      code_intel: true,
      diagnostic: true,
      severity: record.severity,
      code: record.code,
      message: record.message,
      raw: record.raw,
    },
  });
  upsertEdge(db, {
    from_id: fileId(record.file),
    to_id: id,
    relation: 'HAS_DIAGNOSTIC',
    source_file: record.file,
    source_line: record.start_line,
    confidence: 1,
    provenance: 'CODE_INTEL',
    extractor: record.source_name || 'code-intel',
  });
}

export function importCodeIntelRecords(db, inputRecords) {
  const records = inputRecords.map(validateCodeIntelRecord);
  const counts = {
    records: records.length,
    symbols: 0,
    edges: 0,
    includes: 0,
    diagnostics: 0,
  };

  const insert = db.transaction(() => {
    for (const record of records) {
      if (record.kind === 'symbol') {
        upsertSymbol(db, record);
        counts.symbols += 1;
      } else if (record.kind === 'reference' || record.kind === 'call') {
        upsertEdgeLike(db, record);
        counts.edges += 1;
      } else if (record.kind === 'include') {
        upsertInclude(db, record);
        counts.includes += 1;
      } else if (record.kind === 'diagnostic') {
        upsertDiagnostic(db, record);
        counts.diagnostics += 1;
      }
    }
  });
  insert();
  return counts;
}

// ---------------------------------------------------------------------------
// L2a — clangd v0.2 collection → real graph edges (provenance LSP_VERIFIED)
//
// The v0.2 collection envelope's references/definitions become CALLS edges on
// the same nodes/edges tables the static (tree-sitter) graph uses, so
// graph_callers / graph_impact / graph_neighbors can see clangd ground truth.
// LSP_VERIFIED is free-form TEXT (the edges.provenance column has no CHECK);
// it is deliberately NEVER equal to EXTRACTED / INFERRED so render layers can
// rank clangd above heuristics.
// ---------------------------------------------------------------------------

const LSP_PROVENANCE = 'LSP_VERIFIED';

// Node types that can act as a defined symbol or an enclosing caller scope.
const ENCLOSING_TYPES = new Set([
  'Function', 'Method', 'Class', 'Struct', 'Symbol', 'Interface', 'Type', 'Variable',
]);

function lspSymbolNodeId(symbolId) {
  return `ci:lsp:${hash([symbolId])}`;
}

function confidenceToScore(confidence) {
  if (confidence === 'high') return 0.95;
  if (confidence === 'medium') return 0.8;
  return 0.6;
}

// LSP edges are ground truth: insert, and on a (from,to,relation) collision
// with a weaker edge (tree-sitter EXTRACTED / heuristic INFERRED) promote it to
// LSP_VERIFIED. Never downgrades CODE_INTEL (v0.1 path) edges.
const LSP_EDGE_OVERRIDE_SQL = `
  UPDATE edges
  SET source_file = $source_file,
      source_line = $source_line,
      confidence = $confidence,
      provenance = $provenance,
      extractor = $extractor
  WHERE from_id = $from_id
    AND to_id = $to_id
    AND relation = $relation
    AND provenance != 'CODE_INTEL'
`;

function upsertLspEdge(db, edge) {
  const params = {
    from_id: edge.from_id,
    to_id: edge.to_id,
    relation: edge.relation,
    source_file: edge.source_file ?? '',
    source_line: edge.source_line ?? 0,
    confidence: edge.confidence ?? 1.0,
    provenance: LSP_PROVENANCE,
    extractor: edge.extractor ?? 'cpp-clangd',
  };
  upsertEdge(db, params);
  // upsertEdge uses INSERT OR IGNORE and only self-overrides for CODE_INTEL,
  // so a pre-existing tree-sitter/heuristic edge would shadow the LSP one.
  // Re-read; if the landed edge isn't ours, promote it.
  const landed = db.get(
    `SELECT provenance FROM edges WHERE from_id = $from_id AND to_id = $to_id AND relation = $relation`,
    { from_id: params.from_id, to_id: params.to_id, relation: params.relation },
  );
  if (landed && landed.provenance !== LSP_PROVENANCE) {
    db.run(LSP_EDGE_OVERRIDE_SQL, params);
  }
}

// Resolve (or create) the graph node for a defined symbol from a v0.2
// symbol/definition record. Prefers an existing tree-sitter node enclosing the
// definition line (innermost wins); falls back to a CODE_INTEL-style Symbol
// node keyed by symbolId so reference edges always have a target.
function resolveDefinedSymbolNode(db, record, stats) {
  const file = record.file;
  const defLine = record.range?.start?.line ?? null;
  if (file && defLine != null) {
    const placeholders = [...ENCLOSING_TYPES].map((_, i) => `$t${i}`).join(', ');
    const typeParams = {};
    [...ENCLOSING_TYPES].forEach((t, i) => { typeParams[`t${i}`] = t; });
    // FIX C — method-level callee precision. When a clangd symbol/definition
    // (e.g. a constructor or member fn) sits inside BOTH a Method/Function node
    // and its enclosing Class/Struct, prefer the innermost callable so
    // caller→callee edges land on the method, not the class. We rank:
    //   (1) callable types (Function/Method) before container types
    //       (Class/Struct/Interface) — a function enclosed by a class is the
    //       more precise target;
    //   (2) then innermost: largest start_line, smallest span.
    // The CASE keeps the existing innermost fallback for non-callable matches.
    const match = db.get(
      `SELECT id, type, start_line, end_line FROM nodes
        WHERE file_path = $file
          AND start_line <= $line AND end_line >= $line
          AND type IN (${placeholders})
        ORDER BY
          CASE WHEN type IN ('Function', 'Method') THEN 0 ELSE 1 END ASC,
          start_line DESC,
          end_line ASC
        LIMIT 1`,
      { file, line: defLine, ...typeParams },
    );
    if (match) return { nodeId: match.id, nodeType: match.type, startLine: match.start_line, endLine: match.end_line };
  }

  // No tree-sitter node — synthesize a code-intel Symbol node keyed by symbolId.
  const id = lspSymbolNodeId(record.symbolId);
  upsertFileNode(db, file || '', { language: record.language });
  upsertNode(db, {
    id,
    type: 'Symbol',
    label: (record.qname || record.symbolId || '').split(/::|\.|#/u).filter(Boolean).at(-1) ?? record.symbolId,
    file_path: file || '',
    start_line: defLine ?? 0,
    end_line: record.range?.end?.line ?? defLine ?? 0,
    language: record.language ?? '',
    confidence: confidenceToScore(record.confidence),
    structural_fp: '',
    dependency_fp: '',
    extra: {
      qname: record.qname,
      code_intel: true,
      provenance: 'CODE_INTEL',
      symbol_id: record.symbolId,
    },
  });
  stats.nodesCreated += 1;
  return { nodeId: id, nodeType: 'Symbol', startLine: defLine ?? 0, endLine: record.range?.end?.line ?? defLine ?? 0 };
}

// Build a per-file index of candidate enclosing symbols (id,start,end) so the
// caller for each reference can be found without an N+1 query per reference.
function buildEnclosingIndex(db, files) {
  const index = new Map();
  if (files.size === 0) return index;
  const placeholders = [...ENCLOSING_TYPES].map((_, i) => `$t${i}`).join(', ');
  const typeParams = {};
  [...ENCLOSING_TYPES].forEach((t, i) => { typeParams[`t${i}`] = t; });
  for (const file of files) {
    const rows = db.all(
      `SELECT id, start_line, end_line FROM nodes
        WHERE file_path = $file
          AND type IN (${placeholders})
          AND end_line >= start_line
        ORDER BY start_line ASC`,
      { file, ...typeParams },
    );
    index.set(file, rows);
  }
  return index;
}

// Innermost enclosing symbol at refLine: max start_line wins; tie → min end_line.
function findEnclosingCaller(rows, refLine) {
  let best = null;
  for (const row of rows || []) {
    if (row.start_line <= refLine && row.end_line >= refLine) {
      if (
        !best
        || row.start_line > best.start_line
        || (row.start_line === best.start_line && row.end_line < best.end_line)
      ) {
        best = row;
      }
    }
  }
  return best;
}

// Synthesize CALLS edges from a v0.2 collection's references onto the graph.
// Runs inside the importV02Collection transaction (alongside the side-table
// writes). Returns { edgesCreated, nodesCreated, edgesInvalidated }.
function synthesizeLspEdges(envelope, db, stats) {
  const out = { edgesCreated: 0, nodesCreated: 0, edgesInvalidated: 0 };
  const records = Array.isArray(envelope.records) ? envelope.records : [];

  // 1+2. Invalidation: a fresh collection supersedes prior clangd edges so
  // stale ones can't linger (per-repo db).
  const invalidated = db.get(
    `SELECT count(*) AS c FROM edges WHERE provenance = $p`,
    { p: LSP_PROVENANCE },
  );
  out.edgesInvalidated = invalidated?.c ?? 0;
  db.run(`DELETE FROM edges WHERE provenance = $p`, { p: LSP_PROVENANCE });
  // Cheap orphan-node cleanup: drop prior LSP-synthesized symbol nodes that no
  // longer have any edge (real tree-sitter / file nodes are untouched).
  db.run(
    `DELETE FROM nodes
      WHERE id LIKE 'ci:lsp:%'
        AND id NOT IN (SELECT from_id FROM edges UNION SELECT to_id FROM edges)`,
  );

  const nodeStats = { nodesCreated: 0 };
  // 3. defined-symbol node map: symbolId -> { nodeId, nodeType, startLine, endLine, file }.
  //
  // A clangd symbol typically yields TWO records for the same symbolId: a
  // `symbol` record at the .cpp definition body (which encloses the
  // tree-sitter Method/Function node) and a `definition` record at the .h
  // declaration (which only encloses the Class). FIX C: prefer the resolution
  // that lands on a callable (Method/Function) so caller→callee edges target
  // the method, not the enclosing class. Ranking of candidate resolutions:
  //   (1) callable node (Method/Function) beats container/Symbol;
  //   (2) otherwise a real tree-sitter node beats a synthesized ci:lsp Symbol;
  //   (3) otherwise first-seen wins (stable).
  const CALLABLE_TYPES = new Set(['Function', 'Method']);
  const resolutionRank = (nodeType, nodeId) => {
    if (CALLABLE_TYPES.has(nodeType)) return 2;            // best — a method/function
    if (typeof nodeId === 'string' && nodeId.startsWith('ci:lsp:')) return 0; // synthesized fallback
    return 1;                                              // a real container node (Class/Struct/etc.)
  };
  const symbolNodes = new Map();
  for (const record of records) {
    if (record.kind !== 'symbol' && record.kind !== 'definition') continue;
    if (!record.symbolId) continue;
    if (!(record.file && record.range)) {
      // No range to resolve against — only useful if we have nothing yet.
      if (symbolNodes.has(record.symbolId)) continue;
    }
    const resolved = resolveDefinedSymbolNode(db, record, nodeStats);
    const existing = symbolNodes.get(record.symbolId);
    if (existing) {
      // Keep the better-ranked resolution; never let a header-declaration
      // Class resolution clobber a .cpp-body Method resolution.
      const existingRank = resolutionRank(existing.nodeType, existing.nodeId);
      const newRank = resolutionRank(resolved.nodeType, resolved.nodeId);
      if (newRank <= existingRank) continue;
    }
    symbolNodes.set(record.symbolId, {
      nodeId: resolved.nodeId,
      nodeType: resolved.nodeType,
      startLine: resolved.startLine,
      endLine: resolved.endLine,
      file: record.file,
    });
  }
  out.nodesCreated = nodeStats.nodesCreated;

  // 4. per-file enclosing index for the reference sites.
  const refFiles = new Set();
  for (const record of records) {
    if (record.kind === 'reference' && record.result_state === 'found' && record.file) {
      refFiles.add(record.file);
    }
  }
  const enclosingIndex = buildEnclosingIndex(db, refFiles);

  const dbHash8 = String(envelope.session?.compileDbHash ?? '').slice(0, 8);
  const extractor = `cpp-clangd#${dbHash8}`;
  const seen = new Set();

  // 5. references → CALLS edges.
  for (const record of records) {
    if (record.kind !== 'reference') continue;
    if (record.result_state !== 'found') continue;
    if (!record.file || record.range?.start?.line == null) continue;

    const callee = symbolNodes.get(record.symbolId);
    if (!callee) continue; // unknown defined symbol — skip (no bogus edge)

    const refLine = record.range.start.line;

    // caller = innermost enclosing symbol at the ref site; else the File node.
    let callerId;
    const enclosing = findEnclosingCaller(enclosingIndex.get(record.file), refLine);
    if (enclosing) {
      callerId = enclosing.id;
    } else {
      callerId = upsertFileNode(db, record.file, { language: record.language });
    }

    // Skip self-edges.
    if (callerId === callee.nodeId) continue;
    // Skip when the ref site is inside the callee's own definition range in the
    // same file (that's the declaration, not a call).
    if (
      callee.file === record.file
      && callee.startLine != null && callee.endLine != null
      && refLine >= callee.startLine && refLine <= callee.endLine
    ) {
      continue;
    }

    // Dedup identical (from,to,relation,source_line).
    const dedupKey = `${callerId} ${callee.nodeId} CALLS ${refLine}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    upsertLspEdge(db, {
      from_id: callerId,
      to_id: callee.nodeId,
      relation: 'CALLS',
      source_file: record.file,
      source_line: refLine,
      confidence: confidenceToScore(record.confidence),
      extractor,
    });
    out.edgesCreated += 1;
  }

  Object.assign(stats, out);
  return out;
}

function makeRecordInserter(db) {
  ensureCodeIntelRecordsTable(db);
  const sql = `
    INSERT INTO code_intel_records
      (collection_id, kind, language, symbol_id, qname, file, range_start_line, range_end_line, confidence, provenance, result_state, raw)
    VALUES
      (@collection_id, @kind, @language, @symbol_id, @qname, @file, @range_start_line, @range_end_line, @confidence, @provenance, @result_state, @raw)
  `;
  return (record) => {
    const range = record.range || {};
    db.run(sql, {
      collection_id: record.collectionId,
      kind: record.kind,
      language: record.language,
      symbol_id: record.symbolId ?? null,
      qname: record.qname ?? null,
      file: record.file ?? null,
      range_start_line: range.start?.line ?? record.start_line ?? null,
      range_end_line: range.end?.line ?? record.end_line ?? null,
      confidence: record.confidence ?? null,
      provenance: record.provenance ?? null,
      result_state: record.result_state ?? null,
      raw: JSON.stringify(record),
    });
  };
}

function importV02Collection(envelope, db) {
  const stats = {
    schemaVersion: '0.2',
    collectionId: envelope.collectionId,
    collectionStatus: envelope.status,
    operations: envelope.operations,
    recordsImported: 0,
    edgesCreated: 0,
    nodesCreated: 0,
    edgesInvalidated: 0,
  };
  ensureCodeIntelCollectionsTable(db);
  ensureCodeIntelRecordsTable(db);
  const insertRecord = makeRecordInserter(db);
  const firstRecord = envelope.records?.[0];

  const run = db.transaction(() => {
  // FIX A/B: readiness + reference-outcome signals. `index_ready` is the basis
  // for honest exhaustiveness — references are only trustworthy-as-exhaustive
  // when the background index was idle before they were queried. NULL (older
  // collections) reads as "unknown" downstream. Fold the same signals into
  // operations_json so they survive even on graphs that lack the new columns.
  const sess = envelope.session || {};
  const indexReady = sess.indexReady;
  const operationsJson = JSON.stringify({
    ...(envelope.operations || {}),
    _session: {
      mode: sess.mode ?? null,
      indexReady: indexReady ?? null,
      indexWaitMs: sess.indexWaitMs ?? null,
      indexWaitReason: sess.indexWaitReason ?? null,
      refsFoundSymbols: sess.refsFoundSymbols ?? null,
      refsNotFoundSymbols: sess.refsNotFoundSymbols ?? null,
    },
  });
  db.run(
    `INSERT OR REPLACE INTO code_intel_collections
       (collection_id, provider, provider_version, project_root, language, status,
        freshness_basis, freshness_value, compile_db_hash, indexed_commit,
        operations_json, collected_at, errors_json,
        mode, index_ready, index_wait_ms, refs_found, refs_not_found)
     VALUES (@collection_id, @provider, @provider_version, @project_root, @language, @status,
             @freshness_basis, @freshness_value, @compile_db_hash, @indexed_commit,
             @operations_json, @collected_at, @errors_json,
             @mode, @index_ready, @index_wait_ms, @refs_found, @refs_not_found)`,
    {
      collection_id: envelope.collectionId,
      provider: envelope.provider,
      provider_version: envelope.providerVersion,
      project_root: envelope.projectRoot,
      language: firstRecord?.language || 'unknown',
      status: envelope.status,
      freshness_basis: sess.freshnessBasis ?? null,
      freshness_value: sess.freshnessValue ?? sess.compileDbHash ?? null,
      compile_db_hash: sess.compileDbHash ?? null,
      indexed_commit: sess.indexedCommit ?? null,
      operations_json: operationsJson,
      collected_at: sess.collectedAt ?? new Date().toISOString(),
      errors_json: envelope.errors ? JSON.stringify(envelope.errors) : null,
      mode: sess.mode ?? null,
      index_ready: indexReady == null ? null : (indexReady ? 1 : 0),
      index_wait_ms: sess.indexWaitMs ?? null,
      refs_found: sess.refsFoundSymbols ?? null,
      refs_not_found: sess.refsNotFoundSymbols ?? null,
    },
  );
    for (const record of (envelope.records || [])) {
      insertRecord(record);
      stats.recordsImported += 1;
    }

    // L2a: synthesize real graph edges (provenance LSP_VERIFIED) from the
    // clangd references/definitions in the SAME transaction as the side-table
    // writes.
    synthesizeLspEdges(envelope, db, stats);
  });
  run();
  return stats;
}

function importV01Jsonl(raw, db) {
  const records = [];
  const errors = [];
  const lines = raw.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      errors.push({ line: i + 1, message: err.message });
    }
  }
  if (errors.length) {
    const preview = errors.slice(0, 3).map((e) => `${e.line}: ${e.message}`).join('; ');
    const err = new Error(`invalid code-intel JSONL: ${preview}`);
    err.errors = errors;
    throw err;
  }
  const counts = importCodeIntelRecords(db, records);
  return {
    schemaVersion: '0.1',
    recordsImported: counts.records,
    counts,
  };
}

export function importCodeIntel(filepath, db, _options = {}) {
  const raw = readFileSync(filepath, 'utf8').trim();
  if (raw.length === 0) {
    return { schemaVersion: 'unknown', recordsImported: 0 };
  }

  let parsedHead = null;
  try {
    parsedHead = JSON.parse(raw);
  } catch {
    parsedHead = null;
  }

  if (parsedHead && detectSchemaVersion(parsedHead) === '0.2') {
    const validation = validateAny(parsedHead);
    if (!validation.valid) {
      throw new Error(`code-intel v0.2 validation failed: ${validation.errors.join('; ')}`);
    }
    return importV02Collection(parsedHead, db);
  }

  return importV01Jsonl(raw, db);
}
