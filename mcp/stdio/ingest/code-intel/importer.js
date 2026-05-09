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
  };
  ensureCodeIntelCollectionsTable(db);
  const firstRecord = envelope.records?.[0];
  db.run(
    `INSERT OR REPLACE INTO code_intel_collections
       (collection_id, provider, provider_version, project_root, language, status,
        freshness_basis, freshness_value, compile_db_hash, indexed_commit,
        operations_json, collected_at, errors_json)
     VALUES (@collection_id, @provider, @provider_version, @project_root, @language, @status,
             @freshness_basis, @freshness_value, @compile_db_hash, @indexed_commit,
             @operations_json, @collected_at, @errors_json)`,
    {
      collection_id: envelope.collectionId,
      provider: envelope.provider,
      provider_version: envelope.providerVersion,
      project_root: envelope.projectRoot,
      language: firstRecord?.language || 'unknown',
      status: envelope.status,
      freshness_basis: envelope.session?.freshnessBasis ?? null,
      freshness_value: envelope.session?.freshnessValue ?? envelope.session?.compileDbHash ?? null,
      compile_db_hash: envelope.session?.compileDbHash ?? null,
      indexed_commit: envelope.session?.indexedCommit ?? null,
      operations_json: JSON.stringify(envelope.operations || {}),
      collected_at: envelope.session?.collectedAt ?? new Date().toISOString(),
      errors_json: envelope.errors ? JSON.stringify(envelope.errors) : null,
    },
  );
  const insert = makeRecordInserter(db);
  for (const record of envelope.records) {
    insert(record);
    stats.recordsImported += 1;
  }
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
