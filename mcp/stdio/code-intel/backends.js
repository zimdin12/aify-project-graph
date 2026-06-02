// Language-backend registry for the live LSP trust spine.
//
// Replaces the hardcoded `if (language === 'cpp')` in live.js. Each backend
// knows how to spawn its language server for a project root, its cold-start
// timeout, and the collection-provider key. The LspClient itself is generic
// (standard, capability-aware LSP), so a backend is just spawn + metadata.
//
// Provisioning: TS/Python servers are bundled npm deps resolved via
// resolveNodeBin (project-local → plugin-local → PATH), so the host needs no
// LSP config. C++ keeps detect-or-guide (clangd isn't an npm package).

import { buildClangdSpawn } from './resolve-clangd.js';
import { prepareCompileDb } from './compile-db.js';
import { resolveNodeBin } from './node-bin.js';

const CPP_COLD_TIMEOUT_MS = 45000;
const NODE_LSP_COLD_TIMEOUT_MS = 30000;

function cppSpawnFor(projectRoot) {
  let compileDb = null;
  try { compileDb = prepareCompileDb({ projectRoot }); } catch { compileDb = null; }
  return buildClangdSpawn({ projectRoot, compileDb });
}

function tsSpawnFor(projectRoot) {
  const command = resolveNodeBin('typescript-language-server', projectRoot);
  return { command, args: ['--stdio'] };
}

function pythonSpawnFor(projectRoot) {
  const command = resolveNodeBin('pyright-langserver', projectRoot);
  return { command, args: ['--stdio'] };
}

// language → backend descriptor.
const BACKENDS = {
  cpp: { language: 'cpp', spawnFor: cppSpawnFor, coldTimeoutMs: CPP_COLD_TIMEOUT_MS, providerName: 'cpp-clangd' },
  typescript: { language: 'typescript', spawnFor: tsSpawnFor, coldTimeoutMs: NODE_LSP_COLD_TIMEOUT_MS, providerName: 'ts-langserver' },
  python: { language: 'python', spawnFor: pythonSpawnFor, coldTimeoutMs: NODE_LSP_COLD_TIMEOUT_MS, providerName: 'pyright' },
};

// Aliases an agent / file-extension inference might produce.
const LANG_ALIASES = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', c: 'cpp' };

export function normalizeLanguage(language) {
  const l = String(language || '').trim().toLowerCase();
  const aliased = LANG_ALIASES[l] || l;
  // JS shares the TypeScript server.
  return aliased === 'javascript' ? 'typescript' : aliased;
}

export function getBackend(language) {
  return BACKENDS[normalizeLanguage(language)] || null;
}

const EXT_TO_LANG = {
  '.c': 'cpp', '.h': 'cpp', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'typescript', '.jsx': 'typescript', '.mjs': 'typescript', '.cjs': 'typescript',
  '.py': 'python', '.pyi': 'python',
};

// Infer the backend language from a file path's extension. Returns null when the
// extension maps to no backend (caller keeps its explicit/default language).
export function inferLanguage(file) {
  if (!file) return null;
  const m = /\.[A-Za-z0-9]+$/.exec(String(file));
  if (!m) return null;
  return EXT_TO_LANG[m[0].toLowerCase()] || null;
}

export { BACKENDS };
