// Plan #15 Step A3: deterministic structural extract for the intelligence
// pipeline. Reuses the existing tree-sitter scan output (graph DB nodes +
// edges) — does NOT re-run tree-sitter. Outputs the per-file shape the
// file-summarizer LLM agent consumes.
//
// Build order per senior-dev's lock: this layer is fully deterministic,
// dependency-free, and runs without LLM credits. It's also the canonical
// `inputSha` source — whatever the LLM saw must match this serialized
// extract exactly. Consumers can hash this output to detect when re-runs
// are warranted vs cache-reusable.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SYMBOL_NODE_TYPES = new Set([
  'function', 'class', 'method', 'interface', 'struct', 'enum',
  'type', 'variable', 'constant', 'macro'
]);

const EXPORT_RELATIONS = new Set(['exports', 'EXPORTS', 'declares_export']);
const IMPORT_RELATIONS = new Set(['imports', 'IMPORTS', 'depends_on']);

function sha256OfFile(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function countLines(absPath) {
  try {
    const text = fs.readFileSync(absPath, 'utf8');
    if (!text) return 0;
    // Count newlines + 1 if file doesn't end with newline; mirrors `wc -l`-ish.
    let count = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
    if (text[text.length - 1] !== '\n') count++;
    return count;
  } catch { return 0; }
}

function listDistinctFiles(db) {
  return db.all(
    "SELECT DISTINCT file_path AS path FROM nodes WHERE file_path IS NOT NULL AND file_path != '' ORDER BY file_path"
  ).map(r => r.path);
}

function symbolsForFile(db, filePath) {
  const rows = db.all(
    "SELECT type, label, start_line, end_line, language FROM nodes WHERE file_path = $file_path ORDER BY start_line, label",
    { file_path: filePath }
  );
  return rows
    .filter(r => SYMBOL_NODE_TYPES.has(r.type))
    .map(r => ({
      type: r.type,
      name: r.label,
      startLine: r.start_line ?? 0,
      endLine: r.end_line ?? 0
    }));
}

function languageForFile(db, filePath) {
  // Most reliable: first non-empty language on a node from this file.
  const row = db.get(
    "SELECT language FROM nodes WHERE file_path = $file_path AND language IS NOT NULL AND language != '' LIMIT 1",
    { file_path: filePath }
  );
  return row?.language || inferLanguageFromExt(filePath);
}

function inferLanguageFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescriptreact', '.jsx': 'javascriptreact',
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
    '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.h': 'cpp', '.c': 'c',
    '.java': 'java', '.kt': 'kotlin', '.swift': 'swift', '.cs': 'csharp',
    '.php': 'php', '.lua': 'lua', '.glsl': 'glsl'
  }[ext] || '';
}

function exportsForFile(db, filePath) {
  // Files with an "EXPORTS" relation point at the symbol nodes they export.
  // Get the labels (function/class/etc names) of the targeted nodes.
  const rows = db.all(`
    SELECT DISTINCT n.label AS name
    FROM edges e JOIN nodes n ON n.id = e.to_id
    WHERE e.source_file = $file_path
      AND e.relation IN ('exports', 'EXPORTS', 'declares_export')
      AND n.label IS NOT NULL AND n.label != ''
    ORDER BY n.label
  `, { file_path: filePath });
  return rows.map(r => r.name);
}

function importsForFile(db, filePath) {
  // Outbound imports/depends_on from this file. We surface the to_id
  // targets — these may be repo-relative module ids OR external package
  // ids depending on extractor. Consumer treats them as opaque labels.
  const rows = db.all(`
    SELECT DISTINCT to_id AS target
    FROM edges
    WHERE source_file = $file_path
      AND relation IN ('imports', 'IMPORTS', 'depends_on')
      AND to_id IS NOT NULL AND to_id != ''
    ORDER BY target
  `, { file_path: filePath });
  return rows.map(r => r.target);
}

function importedByForFile(db, filePath) {
  // Inbound: which files in the repo import a symbol declared in this file?
  // Use nodes whose file_path = filePath as targets; find edges with relation
  // IMPORTS landing on those nodes; collect distinct source_file values.
  const rows = db.all(`
    SELECT DISTINCT e.source_file AS src
    FROM edges e JOIN nodes n ON n.id = e.to_id
    WHERE n.file_path = $file_path
      AND e.relation IN ('imports', 'IMPORTS', 'depends_on')
      AND e.source_file IS NOT NULL AND e.source_file != ''
      AND e.source_file != $file_path
    ORDER BY src
  `, { file_path: filePath });
  return rows.map(r => r.src);
}

/**
 * Build the deterministic structural extract for the intelligence pipeline.
 *
 * @param {object} ctx
 * @param {string} ctx.repoRoot - absolute path to repo root (for reading file bytes)
 * @param {object} ctx.db - opened APG graph DB (better-sqlite3 wrapper exposing .all/.get/.run)
 * @param {string} ctx.graphHead - git rev (commit SHA) the inputs were drawn from
 * @returns {{
 *   meta: { generatedAt: string, graphHead: string, inputSha: string, fileCount: number },
 *   files: Array<{ path, language, loc, sha, symbols, exports, importsTo, importedBy }>
 * }}
 */
export function buildStructuralExtract({ repoRoot, db, graphHead }) {
  if (!repoRoot) throw new Error('buildStructuralExtract: repoRoot required');
  if (!db) throw new Error('buildStructuralExtract: db required');
  if (!graphHead) throw new Error('buildStructuralExtract: graphHead required');

  const paths = listDistinctFiles(db);
  const files = [];
  for (const p of paths) {
    if (p.includes('\\')) continue; // forward-slash invariant
    const abs = path.join(repoRoot, p);
    const file = {
      path: p,
      language: languageForFile(db, p),
      loc: countLines(abs),
      sha: sha256OfFile(abs),
      symbols: symbolsForFile(db, p),
      exports: exportsForFile(db, p),
      importsTo: importsForFile(db, p),
      importedBy: importedByForFile(db, p)
    };
    files.push(file);
  }

  // Deterministic inputSha — hash the canonical serialization. This is the
  // load-bearing freshness signal: if any input bit changed, the hash flips,
  // and any cached LLM output that claims to derive from a different inputSha
  // is invalid. Sorting paths above + sorting fields within each file ensures
  // stable serialization across runs.
  const canonical = JSON.stringify({ graphHead, files });
  const inputSha = 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      graphHead,
      inputSha,
      fileCount: files.length
    },
    files
  };
}

/**
 * Batch the extract into LLM-friendly chunks. Caps at min(fileCount,
 * charBudget) per batch. Senior-dev's lock: max 20 files OR ~50KB total
 * chars per batch, whichever is smaller.
 *
 * @param {Array} files - from buildStructuralExtract().files
 * @param {object} [opts]
 * @param {number} [opts.maxFiles=20] - hard ceiling per batch
 * @param {number} [opts.maxChars=50000] - soft ceiling per batch (approx)
 * @returns {Array<Array>} array of file batches
 */
export function batchFilesForLlm(files, { maxFiles = 20, maxChars = 50000 } = {}) {
  const batches = [];
  let current = [];
  let currentChars = 0;
  for (const f of files) {
    const approx = JSON.stringify(f).length;
    const wouldExceedCount = current.length >= maxFiles;
    const wouldExceedChars = currentChars + approx > maxChars && current.length > 0;
    if (wouldExceedCount || wouldExceedChars) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(f);
    currentChars += approx;
  }
  if (current.length) batches.push(current);
  return batches;
}
