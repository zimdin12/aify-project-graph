// Plan #15 Step A2: pre-write validator for .aify-graph/semantic.files.json.
//
// Two-tier validation per senior-dev's lock:
//   1. Schema check — shape, enums, required fields, type bounds.
//   2. Cross-reference check — paths exist on disk (catches hallucinated
//      files), no duplicate paths, tags don't contradict functionality.json
//      feature membership.
//
// Refuses to pass on any failure. Caller MUST not write the JSON unless
// validate() returns { ok: true }.
//
// Why duplicate validation in code instead of relying on a JSON-schema
// library: we want cross-reference checks (functionality.json conflict,
// disk-existence) that JSON-schema alone can't express. Keeping it
// dependency-free also keeps install lean.

import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = '0.1';
const ALLOWED_NODE_TYPES = new Set([
  'utility', 'api-handler', 'data-model', 'test', 'config', 'build',
  'doc', 'infra', 'script', 'ui-component', 'service', 'fixture'
]);
const ALLOWED_COMPLEXITY = new Set(['low', 'medium', 'high']);

function isIsoDate(s) {
  if (typeof s !== 'string') return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}T/.test(s);
}

function isSha256Tag(s) {
  return typeof s === 'string' && /^sha256:[0-9a-f]{64}$/.test(s);
}

function checkEnvelope(obj, errs) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errs.push('root must be a non-array object');
    return false;
  }
  if (obj.schema_version !== SCHEMA_VERSION) {
    errs.push(`schema_version must be "${SCHEMA_VERSION}", got ${JSON.stringify(obj.schema_version)}`);
  }
  for (const field of ['generatorVersion', 'generatedAt', 'graphHead', 'inputSha']) {
    if (typeof obj[field] !== 'string' || obj[field].length === 0) {
      errs.push(`${field} must be a non-empty string`);
    }
  }
  if (obj.generatedAt && !isIsoDate(obj.generatedAt)) {
    errs.push(`generatedAt must be ISO-8601, got ${JSON.stringify(obj.generatedAt)}`);
  }
  if (obj.inputSha && !isSha256Tag(obj.inputSha)) {
    errs.push(`inputSha must match "sha256:<64-hex>", got ${JSON.stringify(obj.inputSha)}`);
  }
  if (!Array.isArray(obj.files)) {
    errs.push('files must be an array');
    return false;
  }
  return errs.length === 0;
}

function checkFileEntry(entry, idx, errs) {
  const where = `files[${idx}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errs.push(`${where} must be a non-array object`);
    return;
  }
  if (typeof entry.path !== 'string' || entry.path.length === 0) {
    errs.push(`${where}.path must be a non-empty string`);
  } else if (entry.path.includes('\\')) {
    errs.push(`${where}.path must use forward slashes, got ${JSON.stringify(entry.path)}`);
  }
  if (typeof entry.summary !== 'string' || entry.summary.length === 0) {
    errs.push(`${where}.summary must be a non-empty string`);
  } else if (entry.summary.length > 400) {
    errs.push(`${where}.summary exceeds 400 chars (got ${entry.summary.length})`);
  }
  if (!Array.isArray(entry.tags) || entry.tags.length < 1 || entry.tags.length > 8) {
    errs.push(`${where}.tags must be an array of 1-8 strings`);
  } else {
    for (const t of entry.tags) {
      if (typeof t !== 'string' || t.length === 0 || t.length > 64) {
        errs.push(`${where}.tags contains an invalid tag ${JSON.stringify(t)} (must be 1-64 chars)`);
        break;
      }
    }
  }
  if (!ALLOWED_COMPLEXITY.has(entry.complexity)) {
    errs.push(`${where}.complexity must be one of low|medium|high, got ${JSON.stringify(entry.complexity)}`);
  }
  if (!ALLOWED_NODE_TYPES.has(entry.nodeType)) {
    errs.push(`${where}.nodeType must be one of ${[...ALLOWED_NODE_TYPES].join('|')}, got ${JSON.stringify(entry.nodeType)}`);
  }
  if (typeof entry.entryPoint !== 'boolean') {
    errs.push(`${where}.entryPoint must be boolean`);
  }
}

function checkNoDuplicatePaths(files, errs) {
  const seen = new Set();
  for (const f of files) {
    if (!f || typeof f.path !== 'string') continue;
    if (seen.has(f.path)) {
      errs.push(`duplicate file path: ${f.path}`);
    }
    seen.add(f.path);
  }
}

function checkPathsExistOnDisk(repoRoot, files, errs) {
  // Catches LLM hallucinated paths. Tolerant: only flag absent files;
  // mass absence is itself a separate problem the caller can spot via stats.
  if (!repoRoot) return;
  for (const f of files) {
    if (!f || typeof f.path !== 'string') continue;
    const abs = path.join(repoRoot, f.path);
    try {
      if (!fs.existsSync(abs)) {
        errs.push(`hallucinated file path (does not exist on disk): ${f.path}`);
      }
    } catch { /* ignore stat errors per file */ }
  }
}

function checkTagFunctionalityConflict(files, functionalityJson, warns) {
  // Soft check: warn (not error) on semantic-tag/feature conflict so
  // generators can iterate. functionality.json taxonomy is truth but a
  // warn is enough — strict reject would prevent any generated tags on
  // repos with rich functionality overlays.
  if (!functionalityJson?.features) return;
  // Currently a placeholder hook: build a map of features→file globs, then
  // for each file check that semantic tags don't claim a contradictory
  // feature membership. Real conflict semantics get baked when concrete
  // examples surface.
  const features = functionalityJson.features;
  const featureIds = new Set(features.map(f => f.id));
  for (const f of files) {
    if (!Array.isArray(f.tags)) continue;
    for (const tag of f.tags) {
      // A tag matching a feature id is acceptable (supplemental). Future:
      // detect contradictions where a file's semantic feature tag points at
      // feature X but functionality.json puts it in feature Y.
      if (featureIds.has(tag)) continue;
    }
  }
}

/**
 * Validate a parsed semantic.files.json object.
 * @param {object} obj - parsed JSON
 * @param {object} ctx - { repoRoot?: string, functionalityJson?: object }
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validate(obj, ctx = {}) {
  const errors = [];
  const warnings = [];
  const envOk = checkEnvelope(obj, errors);
  if (!envOk) return { ok: false, errors, warnings };

  obj.files.forEach((f, i) => checkFileEntry(f, i, errors));
  checkNoDuplicatePaths(obj.files, errors);
  if (ctx.repoRoot) checkPathsExistOnDisk(ctx.repoRoot, obj.files, errors);
  if (ctx.functionalityJson) checkTagFunctionalityConflict(obj.files, ctx.functionalityJson, warnings);

  return { ok: errors.length === 0, errors, warnings };
}

export const SEMANTIC_FILES_SCHEMA_VERSION = SCHEMA_VERSION;
export const SEMANTIC_FILES_ALLOWED_NODE_TYPES = ALLOWED_NODE_TYPES;
export const SEMANTIC_FILES_ALLOWED_COMPLEXITY = ALLOWED_COMPLEXITY;
