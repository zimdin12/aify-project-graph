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

function tsCoverage(projectRoot) {
  const hasConfig = ['tsconfig.json', 'jsconfig.json'].some((f) => exists(projectRoot, f));
  if (hasConfig) {
    return { complete: true, partial: false, reason: null, kind: 'tsconfig', foreignToolchain: false, unityUnexpanded: false };
  }
  return {
    complete: false, partial: true, kind: 'tsconfig', foreignToolchain: false, unityUnexpanded: false,
    reason: 'no tsconfig.json / jsconfig.json — the TS language server runs in loose inferred-project mode, so references across untyped/any/dynamic-import boundaries undercount. Add a tsconfig for exhaustive results; verify callers with rg before any delete/rename.',
  };
}

function pythonCoverage() {
  return {
    complete: false, partial: true, kind: 'python_dynamic', foreignToolchain: false, unityUnexpanded: false,
    reason: 'Python call resolution is never provably exhaustive — duck typing, getattr, dynamic dispatch and monkeypatching hide callers from static analysis. Treat the caller set as a FLOOR; verify with rg before any "no callers" / delete / rename claim.',
  };
}

export function computeCoverage({ language, projectRoot, env = process.env } = {}) {
  const lang = normalizeLang(language);
  if (lang === 'typescript' || lang === 'javascript') return tsCoverage(projectRoot);
  if (lang === 'python') return pythonCoverage();
  // Default: C++ / clangd compile-DB coverage. `partial` mirrors the old
  // graph-verb gate (only foreign/unity downgrade pre-collected edges; a DB
  // merely absent at query time does not).
  const cov = computeCompileDbCoverage({ projectRoot, env });
  const partial = cov.complete === false && (Boolean(cov.foreignToolchain) || Boolean(cov.unityUnexpanded));
  return { ...cov, partial, kind: 'compile_db' };
}
