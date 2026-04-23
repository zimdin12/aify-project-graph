// Shared helpers for framework plugins that emit Route nodes + INVOKES
// edges. Factored out of laravel.js so downstream plugins (Python web,
// Express, NestJS, Rails, Spring) don't re-declare the same scaffolding.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { dependencyFingerprint, structuralFingerprint } from '../fingerprint.js';
import { isIgnoredDirName } from '../ignored-dirs.js';

export function stableId(parts) {
  return createHash('sha1').update(parts.join('::')).digest('hex');
}

export function routeNode({ filePath, label, language, startLine = 1, confidence = 0.75 }) {
  const qname = `route:${filePath}:${label}`;
  return {
    id: stableId(['Route', filePath, qname]),
    type: 'Route',
    label,
    file_path: filePath,
    start_line: startLine,
    end_line: startLine,
    language,
    confidence,
    structural_fp: structuralFingerprint({
      qname,
      signature: '',
      decorators: [],
      parentClass: '',
      nodeType: 'Route',
    }),
    dependency_fp: dependencyFingerprint({
      outgoing: { calls: [], references: [], usesTypes: [], imports: [] },
    }),
    extra: { qname },
  };
}

// Recursively collect files under `root` whose extension is in `exts`.
// Skips ignored directories (node_modules, .git, vendor, dist, build,
// __pycache__), including common build-* prefixed scratch trees.
const DEFAULT_IGNORED = new Set([
  'node_modules', '.git', 'vendor', 'dist', 'build', '__pycache__',
  '.next', '.nuxt', '.cache', 'target', '.venv', 'venv', '.aify-graph',
]);

export async function walkFiles(root, exts, {
  ignored = DEFAULT_IGNORED,
  maxFiles = 5000,
  maxBytesPerFile = 1_000_000,
} = {}) {
  const out = [];
  const stack = [root];
  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isIgnoredDirName(entry.name, ignored)) continue;
        stack.push(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!exts.includes(extname(entry.name))) continue;
      const abs = join(dir, entry.name);
      try {
        const s = await stat(abs);
        if (s.size > maxBytesPerFile) continue;
        out.push(abs);
      } catch { /* unreadable, skip */ }
    }
  }
  return out;
}

export function relPath(repoRoot, absPath) {
  return absPath.slice(repoRoot.length + 1).replace(/\\/g, '/');
}

// Emit an INVOKES ref from a Route node to a controller/handler function.
// Helpers keep all framework plugins consistent on the same ref shape that
// the resolver already understands.
export function invokesRef({ node, target, extractor, sourceFile, sourceLine = 1, confidence = 0.75 }) {
  return {
    from_id: node.id,
    from_label: node.label,
    relation: 'INVOKES',
    target,
    source_file: sourceFile,
    source_line: sourceLine,
    confidence,
    provenance: 'INFERRED',
    extractor,
  };
}

export async function tryReadFile(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}
