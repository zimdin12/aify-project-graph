// JS/TS import-specifier resolution: extension probing + tsconfig/jsconfig
// path-aliases. Reimplemented (heuristics only) from understand-anything's
// `extract-import-map.mjs` (MIT) — see docs/code-intel-v2/reference-borrow-
// synthesis.md W3 and ATTRIBUTION.md.
//
// Purpose: a relative import like `./foo` or `../bar/baz` is emitted by the
// extractor as a repo-relative path WITHOUT an extension (`dir/foo`), but the
// File node in the graph is `dir/foo.js`. The plain qname/suffix resolver never
// matches. Likewise `@/foo` / `~/foo` alias specifiers are dropped entirely.
// This module turns a specifier + importer path into the real repo-relative
// file path (matching a candidate file) so the resolver can attach the edge.
//
// Additive by construction: it only ever returns a path that EXISTS in the
// candidate file set, so it can resolve currently-unresolved imports but can
// never invent a path that isn't a real file (no wrong edges).

import { posix } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Extension/index ladder, in priority order. TS first so a `.ts` shadowing a
// generated `.js` resolves to source (matches tsc/bundler precedence closely
// enough for graph attribution).
export const PROBE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
];

// Tolerant JSON parse for tsconfig/jsconfig: strips // and /* */ comments and
// trailing commas (tsconfig is JSONC). Returns null on failure.
function parseJsonc(text) {
  try {
    const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
    // Strip line comments but not inside strings — cheap heuristic: only when
    // the // is not preceded by a ':' URL-ish char is hard; use a conservative
    // line-by-line strip that ignores // appearing after a quote on the line is
    // overkill for tsconfig. tsconfig values are paths/globs, rarely contain //.
    const noLine = noBlock.replace(/(^|[^:"'\\])\/\/[^\n\r]*/g, '$1');
    const noTrailingComma = noLine.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(noTrailingComma);
  } catch {
    return null;
  }
}

// Discover tsconfig/jsconfig files among the candidate files. Returns an array
// of { dir, baseUrl, paths } sorted DEEPEST-FIRST so the nearest-enclosing
// config wins in a monorepo. `dir` is the repo-relative POSIX dir of the
// config; baseUrl is resolved relative to that dir.
export function loadTsConfigs({ repoRoot, fileSet }) {
  const configs = [];
  if (!fileSet) return configs;
  for (const rel of fileSet) {
    const base = rel.split('/').pop();
    if (base !== 'tsconfig.json' && base !== 'jsconfig.json') continue;
    let raw;
    try { raw = readFileSync(join(repoRoot, rel), 'utf8'); } catch { continue; }
    const json = parseJsonc(raw);
    const co = json?.compilerOptions;
    if (!co) continue;
    const baseUrl = typeof co.baseUrl === 'string' ? co.baseUrl : '.';
    const paths = (co.paths && typeof co.paths === 'object') ? co.paths : {};
    if (Object.keys(paths).length === 0 && baseUrl === '.') {
      // No alias info and no non-trivial baseUrl → nothing to contribute.
      // Still keep it if baseUrl is meaningful for bare-from-baseUrl resolution.
    }
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    configs.push({ dir, baseUrl, paths });
  }
  // Deepest dir first (more path segments = nearer to the file).
  configs.sort((a, b) => b.dir.split('/').length - a.dir.split('/').length);
  return configs;
}

// Join a config-dir-relative path into a repo-relative POSIX path, applying
// the LOAD-BEARING leading-`./` strip. create-next-app emits
// `"@/*": ["./*"]`; without normalizing away the leading `./` every alias edge
// resolves to `./dir/foo` which never matches a repo-relative File node.
function configRelToRepoRel(configDir, p) {
  const joined = configDir ? posix.join(configDir, p) : p;
  // posix.normalize collapses `./` and `../`; the result has no leading `./`.
  const normalized = posix.normalize(joined);
  return normalized.replace(/^\.\//, '');
}

// Match a specifier against a single config's `paths` map. Supports the common
// `"@/*": ["./src/*"]` and exact `"@app": ["./src/app"]` forms. Returns an
// array of candidate config-dir-relative substitutions (first wins on probe).
function matchTsAliasInConfig(specifier, config) {
  const out = [];
  for (const [pattern, targets] of Object.entries(config.paths)) {
    const targetList = Array.isArray(targets) ? targets : [targets];
    const starIdx = pattern.indexOf('*');
    if (starIdx === -1) {
      if (specifier === pattern) {
        for (const t of targetList) out.push(t.replace('*', ''));
      }
      continue;
    }
    const prefix = pattern.slice(0, starIdx);
    const suffix = pattern.slice(starIdx + 1);
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix)
      && specifier.length >= prefix.length + suffix.length) {
      const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const t of targetList) out.push(t.replace('*', wildcard));
    }
  }
  return out;
}

// Probe a repo-relative path (possibly extensionless) against the candidate
// file set using the extension/index ladder. Returns the matched repo-relative
// path or null.
export function probeWithExtensions(repoRelPath, fileSet) {
  if (!fileSet || !repoRelPath) return null;
  if (fileSet.has(repoRelPath)) return repoRelPath;
  for (const ext of PROBE_EXTENSIONS) {
    const candidate = repoRelPath + ext;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

// Build the per-repo import-resolution context. Cheap: enumerates candidate
// files once and parses any tsconfig/jsconfig found.
export function buildImportContext({ repoRoot, fileSet }) {
  if (!fileSet) return null;
  const tsconfigs = loadTsConfigs({ repoRoot, fileSet });
  return { repoRoot, fileSet, tsconfigs };
}

// Resolve a JS/TS import specifier to a real repo-relative file path, or null
// when it isn't an intra-repo file (bare npm / node builtin / unmatched alias).
//
//  - importerFile: repo-relative POSIX path of the file doing the import.
//  - specifier:    the raw import string, e.g. `./foo`, `../a/b`, `@/lib/x`.
//
// Strategy:
//  1. Relative (`.`/`..`) → join against importer dir, then probe extensions.
//  2. tsconfig alias match (deepest-enclosing config first) → probe each
//     substitution.
//  3. Otherwise null (let the caller treat as external/bare).
export function resolveImportSpecifier({ specifier, importerFile, ctx }) {
  if (!ctx || !ctx.fileSet || typeof specifier !== 'string') return null;
  const spec = specifier.trim();
  if (!spec) return null;

  // node: builtins and bare scoped/unscoped npm packages are never intra-repo.
  if (spec.startsWith('node:')) return null;

  if (spec.startsWith('.')) {
    const importerDir = importerFile.includes('/')
      ? importerFile.slice(0, importerFile.lastIndexOf('/'))
      : '';
    const joined = posix.normalize(posix.join(importerDir, spec)).replace(/^\.\//, '');
    return probeWithExtensions(joined, ctx.fileSet);
  }

  // Alias resolution via tsconfig paths. Walk configs deepest-first; the first
  // config whose dir encloses the importer AND yields a probe hit wins.
  for (const config of ctx.tsconfigs) {
    const enclosesImporter = config.dir === '' || importerFile.startsWith(`${config.dir}/`);
    if (!enclosesImporter) continue;
    const subs = matchTsAliasInConfig(spec, config);
    for (const sub of subs) {
      const repoRel = configRelToRepoRel(
        config.baseUrl && config.baseUrl !== '.'
          ? posix.normalize(posix.join(config.dir, config.baseUrl))
          : config.dir,
        sub,
      );
      const hit = probeWithExtensions(repoRel, ctx.fileSet);
      if (hit) return hit;
    }
  }

  // baseUrl-relative bare import (non-alias): some tsconfigs set baseUrl: "src"
  // so `components/Foo` resolves from there. Probe only — never invent.
  for (const config of ctx.tsconfigs) {
    if (!config.baseUrl || config.baseUrl === '.') continue;
    const enclosesImporter = config.dir === '' || importerFile.startsWith(`${config.dir}/`);
    if (!enclosesImporter) continue;
    const repoRel = configRelToRepoRel('', posix.normalize(posix.join(config.dir, config.baseUrl, spec)));
    const hit = probeWithExtensions(repoRel, ctx.fileSet);
    if (hit) return hit;
  }

  // Final fallback: the specifier may already be a repo-relative path (the
  // import map stores the extractor's normalized `dir/foo` form, not the raw
  // `./foo`). Probe it directly. Safe — probe only matches an existing file, so
  // a coincidental bare npm name that happens to collide with a real path is
  // the only (vanishingly rare, and still real-file) hit.
  if (spec.includes('/')) {
    const hit = probeWithExtensions(spec, ctx.fileSet);
    if (hit) return hit;
  }

  return null;
}

// Existence-probe convenience used by tests / fallbacks where only a path and a
// repoRoot are available (no prebuilt fileSet).
export function fileExistsRepoRel(repoRoot, repoRel) {
  try { return existsSync(join(repoRoot, repoRel)); } catch { return false; }
}

// ---- regex-based import/require scanning (CJS coverage + call-evidence map) ----
//
// tree-sitter `import_statement` does NOT match CommonJS `require('...')`, so a
// regex pass is needed for CJS coverage and to build the per-file
// localName → specifier map used as import-evidence when resolving short-name
// CALLS/REFERENCES. Reimplemented from understand-anything's extract-import-map
// scanning (MIT).

const ES_IMPORT_RE = /import\s+(?:type\s+)?(?:([\w$]+)\s*(?:,\s*)?)?(?:\{([^}]*)\})?(?:\*\s+as\s+([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g;
const REQUIRE_ASSIGN_RE = /(?:const|let|var)\s+(?:([\w$]+)|\{([^}]*)\})\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
const BARE_REQUIRE_RE = /(?:^|[^.\w])require\(\s*['"]([^'"]+)['"]\s*\)/g;

function addNamed(map, namedBlock, specifier) {
  for (const part of namedBlock.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // `foo as bar` → local name is bar; plain `foo` → foo.
    const local = trimmed.split(/\s+as\s+/).pop().trim();
    if (local && /^[\w$]+$/.test(local)) map.set(local, { source: specifier, exportedName: trimmed.split(/\s+as\s+/)[0].trim() });
  }
}

// Parse a file's source into:
//   localNames: Map<localName, { source, exportedName }>
//   requireSpecifiers: string[]   (all require('x') specifiers, for CJS IMPORTS)
//   esSpecifiers: string[]        (all ES import specifiers — informational)
export function scanFileImports(source) {
  const localNames = new Map();
  const requireSpecifiers = [];
  const esSpecifiers = [];
  if (typeof source !== 'string' || !source) {
    return { localNames, requireSpecifiers, esSpecifiers };
  }

  let m;
  ES_IMPORT_RE.lastIndex = 0;
  while ((m = ES_IMPORT_RE.exec(source))) {
    const [, defaultName, named, namespaceName, specifier] = m;
    esSpecifiers.push(specifier);
    if (defaultName) localNames.set(defaultName, { source: specifier, exportedName: 'default' });
    if (namespaceName) localNames.set(namespaceName, { source: specifier, exportedName: '*' });
    if (named) addNamed(localNames, named, specifier);
  }

  REQUIRE_ASSIGN_RE.lastIndex = 0;
  while ((m = REQUIRE_ASSIGN_RE.exec(source))) {
    const [, defaultName, named, specifier] = m;
    requireSpecifiers.push(specifier);
    if (defaultName) localNames.set(defaultName, { source: specifier, exportedName: 'default' });
    if (named) addNamed(localNames, named, specifier);
  }

  BARE_REQUIRE_RE.lastIndex = 0;
  while ((m = BARE_REQUIRE_RE.exec(source))) {
    requireSpecifiers.push(m[1]);
  }

  return { localNames, requireSpecifiers, esSpecifiers };
}
