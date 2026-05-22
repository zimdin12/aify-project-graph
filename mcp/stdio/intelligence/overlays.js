// Plan #15 Step A5: brief integration — overlay loader.
//
// Reads .aify-graph/semantic.files.json and .aify-graph/architecture.json
// from disk, validates them with the A2 validators, and returns a
// normalized shape for briefs and the dashboard to consume.
//
// Silent-skip semantics: missing files → null fields, validation failure
// → null fields + warnings on the return envelope. Briefs degrade
// gracefully when intelligence isn't present.

import fs from 'node:fs';
import path from 'node:path';
import { validate as validateSemantic } from './validators/semantic-files.js';
import { validate as validateArchitecture } from './validators/architecture.js';

function readJsonOrNull(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Load + validate the intelligence overlays for a repo.
 *
 * @param {object} ctx
 * @param {string} ctx.repoRoot - absolute repo root
 * @param {object} [ctx.functionalityJson] - optional functionality.json for
 *   conflict warnings on semantic tags
 * @returns {{
 *   semanticFiles: object | null,
 *   architecture: object | null,
 *   warnings: string[],
 *   loadedFrom: { semantic?: string, architecture?: string }
 * }}
 */
export function loadIntelligenceOverlays({ repoRoot, functionalityJson } = {}) {
  const warnings = [];
  const loadedFrom = {};
  if (!repoRoot) return { semanticFiles: null, architecture: null, warnings, loadedFrom };

  const semanticPath = path.join(repoRoot, '.aify-graph', 'semantic.files.json');
  const archPath = path.join(repoRoot, '.aify-graph', 'architecture.json');

  let semanticFiles = null;
  const semanticRaw = readJsonOrNull(semanticPath);
  if (semanticRaw) {
    const r = validateSemantic(semanticRaw, { repoRoot, functionalityJson });
    if (r.ok) {
      semanticFiles = semanticRaw;
      loadedFrom.semantic = semanticPath;
    } else {
      warnings.push(`semantic.files.json failed validation (${r.errors.length} errors); ignoring overlay`);
      for (const w of r.warnings) warnings.push(`semantic: ${w}`);
    }
  }

  let architecture = null;
  const archRaw = readJsonOrNull(archPath);
  if (archRaw) {
    const r = validateArchitecture(archRaw, { semanticFilesJson: semanticFiles });
    if (r.ok) {
      architecture = archRaw;
      loadedFrom.architecture = archPath;
    } else {
      warnings.push(`architecture.json failed validation (${r.errors.length} errors); ignoring overlay`);
      for (const w of r.warnings) warnings.push(`architecture: ${w}`);
    }
  }

  return { semanticFiles, architecture, warnings, loadedFrom };
}

/**
 * Summarize the architecture overlay for brief rendering.
 *
 * @param {object} architecture - validated architecture.json
 * @returns {Array<{id, name, description, color, fileCount, lowConfidenceCount}>}
 */
export function summarizeArchitectureLayers(architecture) {
  if (!architecture?.layers || !architecture?.assignments) return [];
  const counts = new Map();
  const lowConfCounts = new Map();
  for (const layer of architecture.layers) {
    counts.set(layer.id, 0);
    lowConfCounts.set(layer.id, 0);
  }
  for (const asg of Object.values(architecture.assignments)) {
    if (!asg?.layerId) continue;
    counts.set(asg.layerId, (counts.get(asg.layerId) || 0) + 1);
    if (asg.confidence === 'low') {
      lowConfCounts.set(asg.layerId, (lowConfCounts.get(asg.layerId) || 0) + 1);
    }
  }
  return architecture.layers.map(layer => ({
    id: layer.id,
    name: layer.name,
    description: layer.description,
    color: layer.color,
    fileCount: counts.get(layer.id) || 0,
    lowConfidenceCount: lowConfCounts.get(layer.id) || 0
  }));
}

/**
 * Look up a single file's semantic enrichment.
 * @param {object} semanticFiles - validated semantic.files.json
 * @param {string} filePath - repo-relative forward-slash path
 * @returns {object | null}
 */
export function semanticForFile(semanticFiles, filePath) {
  if (!semanticFiles?.files) return null;
  return semanticFiles.files.find(f => f.path === filePath) || null;
}
