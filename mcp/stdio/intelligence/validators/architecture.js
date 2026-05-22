// Plan #15 Step A2: pre-write validator for .aify-graph/architecture.json.
//
// Three-tier validation per senior-dev's lock:
//   1. Schema check — shape, enums, required fields.
//   2. Cross-reference vs semantic.files.json — every assignment path
//      must exist in the paired semantic.files.json (catches paths the
//      architecture pass invented). Every layerId must match a layers[].id.
//   3. Coverage check — every file in semantic.files.json must have an
//      assignment (no orphans). Statistic surfaces unassigned count.
//
// Refuses to pass on any failure.

const SCHEMA_VERSION = '0.1';
const ALLOWED_CONFIDENCE = new Set(['low', 'medium', 'high']);
const LAYER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

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
    errs.push(`generatedAt must be ISO-8601`);
  }
  if (obj.inputSha && !isSha256Tag(obj.inputSha)) {
    errs.push(`inputSha must match "sha256:<64-hex>"`);
  }
  if (!Array.isArray(obj.layers)) {
    errs.push('layers must be an array');
    return false;
  }
  if (obj.layers.length < 3 || obj.layers.length > 10) {
    errs.push(`layers must have 3-10 entries, got ${obj.layers.length}`);
  }
  if (!obj.assignments || typeof obj.assignments !== 'object' || Array.isArray(obj.assignments)) {
    errs.push('assignments must be a non-array object');
    return false;
  }
  return errs.length === 0;
}

function checkLayer(layer, idx, errs, layerIds) {
  const where = `layers[${idx}]`;
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
    errs.push(`${where} must be a non-array object`);
    return;
  }
  if (typeof layer.id !== 'string' || !LAYER_ID_PATTERN.test(layer.id)) {
    errs.push(`${where}.id must match ${LAYER_ID_PATTERN}, got ${JSON.stringify(layer.id)}`);
  } else {
    if (layerIds.has(layer.id)) errs.push(`duplicate layer id: ${layer.id}`);
    layerIds.add(layer.id);
  }
  if (typeof layer.name !== 'string' || layer.name.length === 0 || layer.name.length > 64) {
    errs.push(`${where}.name must be a 1-64 char string`);
  }
  if (typeof layer.description !== 'string' || layer.description.length === 0 || layer.description.length > 400) {
    errs.push(`${where}.description must be a 1-400 char string`);
  }
  if (typeof layer.color !== 'string' || !HEX_COLOR_PATTERN.test(layer.color)) {
    errs.push(`${where}.color must be a hex color (#RRGGBB), got ${JSON.stringify(layer.color)}`);
  }
}

function checkAssignment(file, asg, errs, layerIds) {
  if (!asg || typeof asg !== 'object' || Array.isArray(asg)) {
    errs.push(`assignments[${JSON.stringify(file)}] must be a non-array object`);
    return;
  }
  if (typeof asg.layerId !== 'string') {
    errs.push(`assignments[${JSON.stringify(file)}].layerId must be a string`);
  } else if (!layerIds.has(asg.layerId)) {
    errs.push(`assignments[${JSON.stringify(file)}] references unknown layerId ${JSON.stringify(asg.layerId)}`);
  }
  if (!ALLOWED_CONFIDENCE.has(asg.confidence)) {
    errs.push(`assignments[${JSON.stringify(file)}].confidence must be one of low|medium|high, got ${JSON.stringify(asg.confidence)}`);
  }
  if (asg.reason !== undefined && (typeof asg.reason !== 'string' || asg.reason.length > 200)) {
    errs.push(`assignments[${JSON.stringify(file)}].reason must be a string ≤200 chars when present`);
  }
}

/**
 * Validate a parsed architecture.json object.
 * @param {object} obj - parsed JSON
 * @param {object} ctx - { semanticFilesJson?: object } — REQUIRED for full
 *   cross-reference; if omitted only schema + layer-id checks run.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validate(obj, ctx = {}) {
  const errors = [];
  const warnings = [];
  const envOk = checkEnvelope(obj, errors);
  if (!envOk) return { ok: false, errors, warnings };

  const layerIds = new Set();
  obj.layers.forEach((l, i) => checkLayer(l, i, errors, layerIds));

  for (const [filePath, asg] of Object.entries(obj.assignments)) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      errors.push(`assignments contains an empty path key`);
      continue;
    }
    if (filePath.includes('\\')) {
      errors.push(`assignments path uses backslash: ${JSON.stringify(filePath)} (use forward slashes)`);
    }
    checkAssignment(filePath, asg, errors, layerIds);
  }

  // Cross-reference checks against semantic.files.json
  if (ctx.semanticFilesJson) {
    const semanticPaths = new Set(
      (ctx.semanticFilesJson.files || []).map(f => f?.path).filter(Boolean)
    );
    // 1. Every assignment path must be in semantic.files.json
    for (const filePath of Object.keys(obj.assignments)) {
      if (!semanticPaths.has(filePath)) {
        errors.push(`assignment references path not in semantic.files.json (possible hallucination): ${filePath}`);
      }
    }
    // 2. Every semantic.files.json path must have an assignment (no orphans)
    for (const p of semanticPaths) {
      if (!(p in obj.assignments)) {
        errors.push(`semantic.files.json path ${p} has no architecture assignment (orphan)`);
      }
    }
  } else {
    warnings.push('semantic-files cross-reference skipped (semanticFilesJson not provided); full validation requires both inputs');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export const ARCHITECTURE_SCHEMA_VERSION = SCHEMA_VERSION;
export const ARCHITECTURE_LAYER_ID_PATTERN = LAYER_ID_PATTERN;
export const ARCHITECTURE_ALLOWED_CONFIDENCE = ALLOWED_CONFIDENCE;
