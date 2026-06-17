// Per-language "is this caller set exhaustive / safe to delete?" strategy.
//
// The C++ answer is compile-DB coverage (foreign/unity gate). TS and Python have
// no compile DB, so honesty differs:
//   - TypeScript/JS: tsserver "find all references" is strong WHEN a tsconfig/
//     jsconfig scopes the project. Without one it runs a loose inferred project
//     and undercounts across untyped boundaries → partial.
//   - Python: duck typing, getattr, dynamic dispatch and monkeypatching mean a
//     static caller set is NEVER provably exhaustive → always partial (a floor).
//
// Return shape (superset of computeCompileDbCoverage so existing consumers keep
// working): { complete, reason, kind, foreignToolchain, unityUnexpanded, partial }.
//   - `complete:false`  → the LIVE verbs (references/hierarchy) degrade exhaustive.
//   - `partial:true`     → the GRAPH trust banners (callers/preflight) downgrade a
//                          PRE-COLLECTED lsp-verified set. False for "index merely
//                          absent at query time" (cpp no-DB), true for intrinsic
//                          incompleteness (foreign/unity, no-tsconfig, python).

import fs from 'node:fs';
import path from 'node:path';
import { computeCompileDbCoverage } from './compile-db.js';

function normalizeLang(language) {
  const l = String(language || 'cpp').trim().toLowerCase();
  if (l === 'js' || l === 'jsx') return 'javascript';
  if (l === 'ts' || l === 'tsx') return 'typescript';
  if (l === 'py') return 'python';
  return l;
}

function exists(dir, file) {
  try { return fs.existsSync(path.join(dir, file)); } catch { return false; }
}

// Tolerant JSONC parse (tsconfig allows // and /* */ comments + trailing commas).
function parseJsonc(text) {
  try { return JSON.parse(text); } catch { /* fall through to strip */ }
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
  } catch { return null; }
}

// Walk up from `file`'s directory to projectRoot (inclusive) and return the
// nearest tsconfig.json / jsconfig.json. The NEAREST enclosing config is the one
// tsserver actually uses for the file, so root-config presence alone is not
// proof the file is in a configured project (monorepos, src-only configs).
function findNearestTsConfig(projectRoot, file) {
  const root = path.resolve(projectRoot);
  let dir = path.resolve(projectRoot, path.dirname(file));
  // Guard: only search within the repo subtree.
  if (!dir.toLowerCase().startsWith(root.toLowerCase())) dir = root;
  for (;;) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const p = path.join(dir, name);
      if (exists(dir, name)) return { path: p, dir };
    }
    if (path.resolve(dir).toLowerCase() === root.toLowerCase()) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Translate a tsconfig include/exclude glob to a RegExp anchored at the config
// dir. TS semantics: '*' = any run excluding '/', '?' = one non-'/', '**' = any
// run including '/'. A pattern with no wildcard and no extension is a directory
// → implicitly matches its whole subtree.
function tsGlobToRegExp(glob) {
  let g = glob.replace(/\\/g, '/').replace(/\/+$/, '');
  const looksLikeDir = !/[*?]/.test(g) && !/\.[A-Za-z0-9]+$/.test(g);
  if (looksLikeDir) g = `${g}/**/*`;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const DEFAULT_TS_EXCLUDES = ['node_modules', 'bower_components', 'jspm_packages'];

// Does `relFromConfigDir` (forward-slash path relative to the config dir) fall
// inside the project the tsconfig defines?
function tsConfigCoversFile(config, relFromConfigDir) {
  const rel = relFromConfigDir.replace(/\\/g, '/');
  const files = Array.isArray(config?.files) ? config.files.map((f) => String(f).replace(/\\/g, '/')) : null;
  const include = Array.isArray(config?.include) ? config.include : null;
  const exclude = Array.isArray(config?.exclude) ? config.exclude : null;

  // Explicit exclude always wins (also apply TS's default excludes).
  for (const pat of [...(exclude || []), ...DEFAULT_TS_EXCLUDES]) {
    if (tsGlobToRegExp(String(pat)).test(rel)) return false;
  }
  if (files && files.includes(rel)) return true;
  if (include) return include.some((pat) => tsGlobToRegExp(String(pat)).test(rel));
  if (files) return false; // `files` given without `include` → only those files
  // Neither include nor files → TS default-includes the whole config subtree.
  return true;
}

const TS_NO_CONFIG_REASON = 'no tsconfig.json / jsconfig.json — the TS language server runs in loose inferred-project mode, so references across untyped/any/dynamic-import boundaries undercount. Add a tsconfig for exhaustive results; verify callers with rg before any delete/rename.';
const TS_OUT_OF_SCOPE_REASON = 'the queried file is OUTSIDE the nearest tsconfig/jsconfig project scope (not matched by its files/include, or excluded). tsserver runs it in a loose inferred project, so cross-file references undercount. Verify callers with rg before any delete/rename.';

function tsCoverage(projectRoot, file) {
  // File-less callers (e.g. the graph-verb trust path operating on pre-collected
  // edges) keep the coarse "a tsconfig exists at root ⇒ scoped" signal.
  if (!file) {
    const hasConfig = ['tsconfig.json', 'jsconfig.json'].some((f) => exists(projectRoot, f));
    return hasConfig
      ? { complete: true, partial: false, reason: null, kind: 'tsconfig', foreignToolchain: false, unityUnexpanded: false }
      : { complete: false, partial: true, kind: 'tsconfig', foreignToolchain: false, unityUnexpanded: false, reason: TS_NO_CONFIG_REASON };
  }

  // File-aware: find the NEAREST enclosing config and check the file is in scope.
  // Audit 2026-06-12: returning complete:true from mere root-tsconfig presence
  // was a false-exhaustive on monorepos / src-scoped configs.
  const found = findNearestTsConfig(projectRoot, file);
  if (!found) {
    return { complete: false, partial: true, kind: 'tsconfig', foreignToolchain: false, unityUnexpanded: false, reason: TS_NO_CONFIG_REASON };
  }
  let config = null;
  try { config = parseJsonc(fs.readFileSync(found.path, 'utf8')); } catch { config = null; }
  // Parse failure → can't confirm scope → be honest (partial), not exhaustive.
  if (!config || typeof config !== 'object') {
    return { complete: false, partial: true, kind: 'tsconfig', foreignToolchain: false, unityUnexpanded: false, reason: TS_OUT_OF_SCOPE_REASON };
  }
  // NB: `extends` chains (include declared in a base config) are not followed yet
  // (W3). A config that only `extends` looks like "no include" here → treated as
  // covering its subtree, which matches today's behavior (no new false-positive).
  const absFile = path.resolve(projectRoot, file);
  const relFromConfigDir = path.relative(found.dir, absFile).replace(/\\/g, '/');
  if (tsConfigCoversFile(config, relFromConfigDir)) {
    return { complete: true, partial: false, reason: null, kind: 'tsconfig', foreignToolchain: false, unityUnexpanded: false };
  }
  return { complete: false, partial: true, kind: 'tsconfig', foreignToolchain: false, unityUnexpanded: false, reason: TS_OUT_OF_SCOPE_REASON };
}

function pythonCoverage() {
  return {
    complete: false, partial: true, kind: 'python_dynamic', foreignToolchain: false, unityUnexpanded: false,
    reason: 'Python call resolution is never provably exhaustive — duck typing, getattr, dynamic dispatch and monkeypatching hide callers from static analysis. Treat the caller set as a FLOOR; verify with rg before any "no callers" / delete / rename claim.',
  };
}

export function computeCoverage({ language, projectRoot, file = null, env = process.env } = {}) {
  const lang = normalizeLang(language);
  if (lang === 'typescript' || lang === 'javascript') return tsCoverage(projectRoot, file);
  if (lang === 'python') return pythonCoverage();
  // Default: C++ / clangd compile-DB coverage. `partial` mirrors the old
  // graph-verb gate (only foreign/unity downgrade pre-collected edges; a DB
  // merely absent at query time does not).
  const cov = computeCompileDbCoverage({ projectRoot, env });
  const partial = cov.complete === false && (Boolean(cov.foreignToolchain) || Boolean(cov.unityUnexpanded));
  return { ...cov, partial, kind: 'compile_db' };
}
