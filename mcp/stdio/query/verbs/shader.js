import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';

/**
 * graph_shader — L5 C++<->GLSL shader-binding bridge.
 *
 * Input: { repo, shader?:<file or basename>, binding?:'set.binding' }
 *
 * Output (compact, budgeted):
 *   - the shader's descriptor binding table (set / binding / access / block)
 *   - the C++ files/symbols that LOAD it (LOADS_SHADER)
 *   - GLSL #include edges
 *   - a heuristic BINDING CONTRACT section: bindings with no detected C++
 *     descriptor-write site (flagged "declared, no C++ writer found — verify")
 *
 * Honest caveat banner: this is static structural linking (tree-sitter/regex),
 * not a compiler/descriptor-layout check.
 */

const CAVEAT = 'NOTE: static structural link (regex over GLSL+C++), not a compiler/descriptor-layout check. Treat writer-coverage as a hint, verify in source.';

function basenameOf(p) {
  const norm = String(p || '').replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function parseExtra(node) {
  if (!node) return {};
  if (typeof node.extra === 'string') {
    try { return JSON.parse(node.extra); } catch { return {}; }
  }
  return node.extra ?? {};
}

export async function graphShader({ repoRoot, shader, binding, top_k = 40 }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_shader' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    return prefixReadWarnings(graphShaderInner(db, { shader, binding, top_k }), freshness.warnings);
  } finally {
    db.close();
  }
}

// Resolve a shader argument (full path or basename) to the set of shader File
// nodes that have at least one binding declared. If no shader is given, list
// the shaders that have bindings so the caller can pick.
function resolveShaderFiles(db, shader) {
  if (!shader) {
    const rows = db.all(
      `SELECT DISTINCT file_path FROM nodes
       WHERE type = 'ShaderBinding' AND language = 'glsl'
       ORDER BY file_path`
    );
    return { list: rows.map((r) => r.file_path) };
  }
  const bn = basenameOf(shader).toLowerCase();
  // Match either the exact relative path or the basename of a shader file that
  // actually carries bindings.
  const rows = db.all(
    `SELECT DISTINCT file_path FROM nodes
     WHERE type = 'ShaderBinding' AND language = 'glsl'
       AND (lower(file_path) = $full OR lower(file_path) LIKE $suffix)`,
    { full: String(shader).replace(/\\/g, '/').toLowerCase(), suffix: `%/${bn}` }
  );
  // Fall back: also allow matching shaders that have a File node but no bindings.
  if (rows.length === 0) {
    const fileRows = db.all(
      `SELECT DISTINCT file_path FROM nodes
       WHERE type = 'File' AND language = 'glsl'
         AND (lower(file_path) = $full OR lower(file_path) LIKE $suffix)`,
      { full: String(shader).replace(/\\/g, '/').toLowerCase(), suffix: `%/${bn}` }
    );
    return { files: fileRows.map((r) => r.file_path) };
  }
  return { files: rows.map((r) => r.file_path) };
}

function bindingsForShader(db, shaderFile) {
  return db.all(
    `SELECT * FROM nodes
     WHERE type = 'ShaderBinding' AND language = 'glsl' AND file_path = $f
     ORDER BY json_extract(extra, '$.set'), json_extract(extra, '$.binding')`,
    { f: shaderFile }
  ).map((n) => ({ node: n, extra: parseExtra(n) }));
}

// C++ files/symbols that LOADS_SHADER this shader file.
function loadersForShader(db, shaderFileId) {
  return db.all(
    `SELECT e.source_file AS cpp_file, e.source_line, e.confidence, n.label AS from_label
     FROM edges e
     LEFT JOIN nodes n ON n.id = e.from_id
     WHERE e.relation = 'LOADS_SHADER' AND e.to_id = $tid
     ORDER BY e.source_file, e.source_line`,
    { tid: shaderFileId }
  );
}

function includesForShader(db, shaderFile) {
  return db.all(
    `SELECT e.source_line, n.label AS to_label, n.file_path AS to_file
     FROM edges e
     JOIN nodes n ON n.id = e.to_id
     WHERE e.relation = 'IMPORTS' AND e.source_file = $f AND n.type = 'File' AND n.language = 'glsl'
     ORDER BY e.source_line`,
    { f: shaderFile }
  );
}

// Descriptor-write binding numbers detected in any C++ loader of this shader.
// Best-effort, heuristic (binding number only — no block-name proof).
function descriptorWritesFor(db, cppFiles) {
  const writes = new Map(); // binding -> [{cpp_file, symbol, line}]
  if (cppFiles.size === 0) return writes;
  const rows = db.all(
    `SELECT extra FROM nodes
     WHERE type = 'ShaderBinding' AND language = 'cpp'`
  );
  for (const row of rows) {
    const extra = parseExtra(row);
    if (!Array.isArray(extra.descriptor_writes)) continue;
    if (!cppFiles.has(extra.cpp_file)) continue;
    for (const w of extra.descriptor_writes) {
      const list = writes.get(w.binding) ?? [];
      list.push(w);
      writes.set(w.binding, list);
    }
  }
  return writes;
}

function fileNodeIdFor(db, shaderFile) {
  const row = db.get(
    "SELECT id FROM nodes WHERE type = 'File' AND file_path = $f LIMIT 1",
    { f: shaderFile }
  );
  return row?.id ?? null;
}

function graphShaderInner(db, { shader, binding, top_k }) {
  const lines = [];
  const resolved = resolveShaderFiles(db, shader);

  if (resolved.list) {
    if (resolved.list.length === 0) {
      return 'NO SHADER BINDINGS indexed. Run graph_index(force=true). If this repo has GLSL shaders with layout(binding=...) decls and still nothing appears, the convention may differ — report it.';
    }
    lines.push(`SHADERS WITH BINDINGS (${resolved.list.length}) — pass shader=<basename> for the binding table:`);
    for (const f of resolved.list.slice(0, top_k)) lines.push(`  ${f}`);
    if (resolved.list.length > top_k) lines.push(`  ... +${resolved.list.length - top_k} more`);
    return lines.join('\n');
  }

  const files = resolved.files ?? [];
  if (files.length === 0) {
    return `NO SHADER matching "${shader}". Call graph_shader() with no args to list shaders that have bindings.`;
  }

  // Optional binding filter: 'set.binding' or bare 'binding'.
  let wantSet = null;
  let wantBinding = null;
  if (binding != null && binding !== '') {
    const parts = String(binding).split('.');
    if (parts.length === 2) { wantSet = Number(parts[0]); wantBinding = Number(parts[1]); }
    else { wantBinding = Number(parts[0]); }
  }

  lines.push(CAVEAT);

  for (const shaderFile of files.slice(0, 12)) {
    const shaderFileId = fileNodeIdFor(db, shaderFile);
    let bindings = bindingsForShader(db, shaderFile);
    if (wantBinding != null) {
      bindings = bindings.filter((b) =>
        b.extra.binding === wantBinding && (wantSet == null || b.extra.set === wantSet));
    }

    lines.push('');
    lines.push(`SHADER ${shaderFile}`);

    if (bindings.length === 0) {
      lines.push(binding ? `  (no binding ${binding} declared here)` : '  (no bindings declared)');
    } else {
      lines.push(`  BINDING TABLE (${bindings.length}):`);
      lines.push('    set.binding  access      kind     block');
      for (const b of bindings.slice(0, top_k)) {
        const e = b.extra;
        lines.push(`    ${String(e.set)}.${String(e.binding).padEnd(2)}        ${String(e.access).padEnd(10)} ${String(e.kind).padEnd(7)} ${e.block_name} :${b.node.start_line}`);
      }
    }

    // Loaders (C++ -> shader)
    const loaders = shaderFileId ? loadersForShader(db, shaderFileId) : [];
    if (loaders.length > 0) {
      lines.push(`  LOADED BY ${loaders.length} C++ site(s):`);
      for (const l of loaders.slice(0, top_k)) {
        lines.push(`    ${l.cpp_file}:${l.source_line}${l.from_label ? ` (${l.from_label})` : ''} conf=${Number(l.confidence ?? 0).toFixed(2)}`);
      }
    } else {
      lines.push('  LOADED BY: (no C++ loadFile("...") site detected — verify)');
    }

    // GLSL includes
    const includes = shaderFile ? includesForShader(db, shaderFile) : [];
    if (includes.length > 0) {
      lines.push(`  INCLUDES ${includes.length}:`);
      for (const inc of includes.slice(0, top_k)) lines.push(`    ${inc.to_file ?? inc.to_label} :${inc.source_line}`);
    }

    // BINDING CONTRACT — heuristic: which declared bindings have a C++
    // descriptor-write at the matching binding number among this shader's
    // loaders. Never a hard claim.
    const cppFiles = new Set(loaders.map((l) => l.cpp_file));
    const writes = descriptorWritesFor(db, cppFiles);
    if (bindings.length > 0) {
      const contractLines = [];
      for (const b of bindings) {
        const e = b.extra;
        const hit = writes.get(e.binding);
        if (hit && hit.length > 0) {
          const where = hit.map((w) => `${basenameOf(w.cpp_file)}:${w.line}${w.symbol ? `(${w.symbol})` : ''}`).join(', ');
          contractLines.push(`    set ${e.set} binding ${e.binding} ${e.block_name}: C++ descriptor-write at ${where} (heuristic match by binding number)`);
        } else {
          contractLines.push(`    set ${e.set} binding ${e.binding} ${e.block_name}: declared, no C++ writer found — verify`);
        }
      }
      lines.push('  BINDING CONTRACT (heuristic — binding-number match only, no block-name proof):');
      lines.push(...contractLines);
    }
  }

  if (files.length > 12) lines.push('', `... +${files.length - 12} more matching shader files (narrow with a fuller path)`);

  return lines.join('\n');
}
