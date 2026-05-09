import { readFile } from 'node:fs/promises';
import { isV02Collection, validateCollection as validateV02Collection, validateRecord as validateV02Record } from './v02.js';

export const CODE_INTEL_SCHEMA_VERSION = '0.1';

export const CODE_INTEL_RECORD_KINDS = new Set([
  'symbol',
  'reference',
  'call',
  'include',
  'diagnostic',
]);

const NODE_TYPE_BY_SYMBOL_KIND = new Map([
  ['class', 'Class'],
  ['struct', 'Class'],
  ['interface', 'Interface'],
  ['enum', 'Type'],
  ['typedef', 'Type'],
  ['type', 'Type'],
  ['function', 'Function'],
  ['method', 'Method'],
  ['constructor', 'Method'],
  ['destructor', 'Method'],
  ['variable', 'Variable'],
  ['field', 'Variable'],
  ['namespace', 'Module'],
  ['module', 'Module'],
]);

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function optionalNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optionalConfidence(value) {
  const n = optionalNumber(value, 1);
  return Math.min(1, Math.max(0, n));
}

function normalizePath(value, label) {
  return requiredString(value, label).replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeRange(record) {
  const range = record.range && typeof record.range === 'object' ? record.range : {};
  const startLine = optionalNumber(record.start_line ?? range.start_line ?? range.start?.line, 1);
  const endLine = optionalNumber(record.end_line ?? range.end_line ?? range.end?.line, startLine);
  return {
    start_line: Math.max(1, Math.floor(startLine)),
    end_line: Math.max(Math.max(1, Math.floor(startLine)), Math.floor(endLine)),
  };
}

function inferLabel(qname) {
  const parts = qname.split(/::|\.|#/u).filter(Boolean);
  return parts.at(-1) ?? qname;
}

export function nodeTypeForCodeIntelSymbol(kind) {
  return NODE_TYPE_BY_SYMBOL_KIND.get((kind || '').toLowerCase()) ?? 'Symbol';
}

function normalizeSymbol(record) {
  const qname = requiredString(record.qname ?? record.name, 'symbol.qname');
  const file = normalizePath(record.file ?? record.file_path, 'symbol.file');
  const range = normalizeRange(record);
  const symbolKind = optionalString(record.symbol_kind ?? record.symbolKind ?? record.type, 'symbol').toLowerCase();
  const nodeType = optionalString(record.node_type ?? record.nodeType, '') || nodeTypeForCodeIntelSymbol(symbolKind);
  return {
    kind: 'symbol',
    schema_version: optionalString(record.schema_version ?? record.schemaVersion, CODE_INTEL_SCHEMA_VERSION),
    id: optionalString(record.id),
    qname,
    name: optionalString(record.name, inferLabel(qname)),
    symbol_kind: symbolKind,
    node_type: nodeType,
    file,
    ...range,
    language: optionalString(record.language, ''),
    confidence: optionalConfidence(record.confidence),
    source: optionalString(record.source, 'code-intel'),
    raw: record.raw && typeof record.raw === 'object' ? record.raw : {},
  };
}

function normalizeEdgeLike(record, kind) {
  const source = asObject(record.source ?? record.from, `${kind}.source`);
  const target = asObject(record.target ?? record.to, `${kind}.target`);
  const sourceQname = requiredString(source.qname ?? source.name, `${kind}.source.qname`);
  const targetQname = requiredString(target.qname ?? target.name, `${kind}.target.qname`);
  const file = normalizePath(record.file ?? record.file_path ?? source.file ?? source.file_path, `${kind}.file`);
  const range = normalizeRange(record);
  const relation = optionalString(record.relation, kind === 'call' ? 'CALLS' : 'REFERENCES').toUpperCase();
  return {
    kind,
    schema_version: optionalString(record.schema_version ?? record.schemaVersion, CODE_INTEL_SCHEMA_VERSION),
    relation,
    source: {
      qname: sourceQname,
      name: optionalString(source.name, inferLabel(sourceQname)),
      file: optionalString(source.file ?? source.file_path, ''),
      line: optionalNumber(source.line ?? source.start_line, 0),
    },
    target: {
      qname: targetQname,
      name: optionalString(target.name, inferLabel(targetQname)),
      file: optionalString(target.file ?? target.file_path, ''),
      line: optionalNumber(target.line ?? target.start_line, 0),
      external: Boolean(target.external),
    },
    file,
    ...range,
    language: optionalString(record.language, ''),
    confidence: optionalConfidence(record.confidence),
    source_name: optionalString(record.source_name, 'code-intel'),
    raw: record.raw && typeof record.raw === 'object' ? record.raw : {},
  };
}

function normalizeInclude(record) {
  const sourceFile = normalizePath(record.source_file ?? record.file ?? record.from, 'include.source_file');
  const targetFile = normalizePath(record.target_file ?? record.target ?? record.to, 'include.target_file');
  const range = normalizeRange(record);
  return {
    kind: 'include',
    schema_version: optionalString(record.schema_version ?? record.schemaVersion, CODE_INTEL_SCHEMA_VERSION),
    relation: optionalString(record.relation, 'IMPORTS').toUpperCase(),
    source_file: sourceFile,
    target_file: targetFile,
    ...range,
    language: optionalString(record.language, ''),
    confidence: optionalConfidence(record.confidence),
    source_name: optionalString(record.source_name, 'code-intel'),
    raw: record.raw && typeof record.raw === 'object' ? record.raw : {},
  };
}

function normalizeDiagnostic(record) {
  const file = normalizePath(record.file ?? record.file_path, 'diagnostic.file');
  const range = normalizeRange(record);
  return {
    kind: 'diagnostic',
    schema_version: optionalString(record.schema_version ?? record.schemaVersion, CODE_INTEL_SCHEMA_VERSION),
    file,
    ...range,
    severity: optionalString(record.severity, 'info'),
    code: optionalString(record.code, ''),
    message: requiredString(record.message, 'diagnostic.message'),
    source_name: optionalString(record.source_name, 'code-intel'),
    raw: record.raw && typeof record.raw === 'object' ? record.raw : {},
  };
}

export function validateCodeIntelRecord(input) {
  const record = asObject(input, 'record');
  const kind = requiredString(record.kind, 'record.kind').toLowerCase();
  if (!CODE_INTEL_RECORD_KINDS.has(kind)) {
    throw new Error(`record.kind must be one of ${[...CODE_INTEL_RECORD_KINDS].join(', ')}`);
  }
  if (kind === 'symbol') return normalizeSymbol(record);
  if (kind === 'reference' || kind === 'call') return normalizeEdgeLike(record, kind);
  if (kind === 'include') return normalizeInclude(record);
  return normalizeDiagnostic(record);
}

export async function readCodeIntelJsonl(path) {
  const text = await readFile(path, 'utf8');
  const records = [];
  const errors = [];
  const lines = text.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    try {
      records.push(validateCodeIntelRecord(JSON.parse(line)));
    } catch (err) {
      errors.push({ line: i + 1, message: err.message });
    }
  }
  if (errors.length) {
    const preview = errors.slice(0, 3).map((e) => `${e.line}: ${e.message}`).join('; ');
    const err = new Error(`invalid code-intel JSONL (${errors.length} error${errors.length === 1 ? '' : 's'}): ${preview}`);
    err.errors = errors;
    throw err;
  }
  return records;
}

export function detectSchemaVersion(value) {
  if (!value || typeof value !== 'object') return 'unknown';
  if (isV02Collection(value)) return '0.2';
  if (value.schema_version === '0.2') return '0.2';
  return '0.1';
}

export function validateAny(value) {
  const version = detectSchemaVersion(value);
  if (version === '0.2') {
    return Array.isArray(value.records)
      ? validateV02Collection(value)
      : validateV02Record(value);
  }
  return { valid: true, errors: [], version };
}
