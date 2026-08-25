// Shared helpers for framework plugins that emit Route nodes + INVOKES
// edges. Factored out of laravel.js so downstream plugins (Python web,
// Express, NestJS, Rails, Spring) don't re-declare the same scaffolding.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { dependencyFingerprint, structuralFingerprint } from '../fingerprint.js';
import { isIgnoredDirName, loadEffectiveIgnoredDirs } from '../ignored-dirs.js';

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
//
// ⛔ THE DEFAULT IS THE EFFECTIVE IGNORE SET, NOT THE BUILT-IN LIST, AND THAT IS A FIX.
//
// This defaulted to the bare `IGNORED_DIRS` constant — a hardcoded list of directory NAMES that
// never consults `.gitignore`. The structural sweep uses `loadEffectiveIgnoredDirs`, which folds
// in `.gitignore`, `.aifyignore` and `.aifyinclude`. So there were TWO WALKERS WITH TWO ADMISSION
// POLICIES, and the weaker one silently indexed what the stronger one declined.
//
// the field test found it from outside: 3 `Test` nodes in this repo's graph sourced from
// `reference/graphify/tests/fixtures/sample_doctest.cpp`, under `.gitignore:12 reference/`, a
// path `git ls-files` does not know. Content nodes past an exclusion is not the same thing as
// directory nodes past one — something read a file it was told not to.
//
// ⚠ ALL ELEVEN CALL SITES WERE AFFECTED, NOT ONE. Every plugin calls `walkFiles(repoRoot, exts)`
// and NONE passes `ignored`, so django, nestjs, node_web, python_web, rails, spring,
// shader_bindings and cpp_frameworks all walked with the weak list. This repo only showed 3 nodes
// because `reference/` happens to hold little these plugins can parse; on a repo with a
// gitignored vendor or build tree full of .py/.ts/.rb/.java, those become first-party symbols.
//
// ★ AND THE COMMENT THIS REPLACES RECORDS THE SAME BUG ONE GENERATION EARLIER: "R2-2026-05-31 BUG
// 3: the previous local list omitted `.claude` / `worktrees`, so `.claude/worktrees/` agent shader
// copies were indexed as first-party ShaderBinding nodes." The remedy then was to SHARE THE NAME
// LIST. Sharing a list makes two copies agree about the names on it and says nothing about the
// names that were never on it — membership by name, which is the mechanism this codebase has now
// inverted away from three times. Sharing the PREDICATE is what closes it.
//
// The parameter stays, so a caller with a genuinely different policy can still pass one; what
// changed is that forgetting now gets you the strict answer instead of the lax one.
export async function walkFiles(root, exts, {
  ignored = null,
  maxFiles = 5000,
  maxBytesPerFile = 1_000_000,
} = {}) {
  const effective = ignored ?? loadEffectiveIgnoredDirs(root);
  const out = [];
  const stack = [root];
  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isIgnoredDirName(entry.name, effective)) continue;
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
