// JS/TS extract-time augmentation, shared by languages/javascript.js and
// languages/typescript.js. Two jobs:
//
//  P3-1 (CJS coverage): tree-sitter's `import_statement` rule misses CommonJS
//    `require('...')`. We scan the source with a regex pass and emit an extra
//    IMPORTS ref (target = the specifier, raw) for each require specifier not
//    already covered by an ES import. The resolver's IMPORTS probe branch then
//    turns relative/alias specifiers into File-node edges.
//
//  P3-2 (import-evidence): we attach the per-file localName→{source,exportedName}
//    import map (from BOTH ES imports and require destructuring) onto every
//    CALLS/REFERENCES ref the walker already produced for this file. The
//    resolver consults that map to resolve a short-name call ONLY when the
//    callee is an imported alias that maps to exactly one node (graphify
//    Tier-A). The map is small (a handful of names per file) and attached by
//    reference, so this is cheap.
//
// Reimplemented heuristics from understand-anything's extract-import-map.mjs
// (MIT). Additive: never removes or rewrites existing refs/edges.

import { posix } from 'node:path';
import { scanFileImports } from './import-resolution.js';

// Mirror normalizeImportSource in languages/javascript.js + typescript.js so
// require() relative specifiers land in the same `dir/foo` form ES imports use.
function normalizeRequireSpecifier(raw, filePath) {
  const spec = raw.trim();
  if (!spec) return '';
  if (spec.startsWith('.')) {
    return posix.normalize(posix.join(posix.dirname(filePath), spec)).replace(/^\.\//u, '');
  }
  return spec;
}

export function augmentJsImports({ source, filePath, refs, extractor, fileNode }) {
  const { localNames, requireSpecifiers } = scanFileImports(source);

  // Attach the import map to existing CALLS/REFERENCES refs as resolution
  // evidence. Serialize to a plain object so it survives the SQLite/JSON
  // round-trip if a ref is ever carried forward; the resolver reads either
  // shape. Keep it as a plain object keyed by local name.
  const importMap = {};
  for (const [local, info] of localNames) {
    importMap[local] = { source: info.source, exportedName: info.exportedName };
  }
  const hasImports = Object.keys(importMap).length > 0;
  if (hasImports) {
    for (const ref of refs) {
      if (ref.relation === 'CALLS' || ref.relation === 'REFERENCES') {
        // Only attach when this file's import map actually contains the target —
        // keeps refs lean and makes the resolver's check O(1).
        if (Object.prototype.hasOwnProperty.call(importMap, ref.target)) {
          ref.importMap = importMap;
        }
      }
    }
  }

  // Emit IMPORTS refs for require() specifiers (deduped against what the ES
  // import pass already produced — we don't have direct access to those targets
  // here, but the resolver/categorizer dedupe identical edges, and emitting a
  // require specifier that also appears as an ES import is harmless: it
  // produces the same edge).
  const extraImportRefs = [];
  if (!fileNode) return extraImportRefs;
  const seen = new Set();
  // Avoid double-emitting an IMPORTS edge the ES-import pass already produced:
  // collect targets already present on this file's IMPORTS refs.
  const existingImportTargets = new Set(
    refs.filter((r) => r.relation === 'IMPORTS').map((r) => r.target),
  );
  for (const rawSpecifier of requireSpecifiers) {
    const specifier = normalizeRequireSpecifier(rawSpecifier, filePath);
    if (!specifier || seen.has(specifier)) continue;
    seen.add(specifier);
    if (existingImportTargets.has(specifier)) continue;
    extraImportRefs.push({
      from_id: fileNode.id,
      from_label: fileNode.label,
      relation: 'IMPORTS',
      target: specifier,
      source_file: filePath,
      source_line: 0,
      confidence: 0.9,
      provenance: 'EXTRACTED',
      extractor,
    });
  }
  return extraImportRefs;
}
