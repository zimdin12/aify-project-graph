// Python code-intel provider (pyright-langserver).
//
// Thin wrapper over the shared LSP collection engine. Pyright speaks standard
// LSP (references, definition, hover, documentSymbol, callHierarchy). The honest
// caveat — Python call resolution is never provably exhaustive (duck typing,
// getattr, dynamic dispatch, monkeypatching) — is expressed by the python
// coverage strategy (code-intel/coverage.js), so the verbs always degrade a
// Python caller set to a FLOOR rather than "safe to delete".

import fs from 'node:fs';
import path from 'node:path';
import { nodeLspSpawn } from '../node-bin.js';
import { collectViaLsp } from './lsp-collect.js';

const PROVIDER_NAME = 'pyright';
const PROVIDER_VERSION = '0.1.0';

const EXTS = new Set(['.py', '.pyi']);
const SKIP_DIRS = new Set(['.venv', 'venv', 'env', 'site-packages', '__pycache__', '.git', 'node_modules', 'build', 'dist', '.tox', '.mypy_cache', '.pytest_cache']);

export function pythonSpawnFor(projectRoot) {
  return nodeLspSpawn({ pkgName: 'pyright', binName: 'pyright-langserver', args: ['--stdio'], projectRoot });
}

function enumeratePyFiles(projectRoot, { maxFiles = 200 } = {}) {
  const files = [];
  let scanned = 0;
  let truncated = false;
  const walk = (dir) => {
    if (files.length >= maxFiles) { truncated = true; return; }
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (files.length >= maxFiles) { truncated = true; return; }
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        walk(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        if (!EXTS.has(path.extname(ent.name).toLowerCase())) continue;
        scanned += 1;
        files.push(path.relative(projectRoot, path.join(dir, ent.name)).replace(/\\/g, '/'));
      }
    }
  };
  walk(projectRoot);
  return { files, stats: { total: scanned, after_filter: files.length, truncated, max_files: maxFiles } };
}

export function createPyrightProvider({ spawn } = {}) {
  return {
    capabilities() {
      return {
        provider: PROVIDER_NAME, version: PROVIDER_VERSION,
        languages: ['python'],
        operations: ['definitions', 'references', 'hover', 'diagnostics', 'symbols'],
        freshnessBasis: 'mtime', warmupRequired: false,
        // Python is never provably exhaustive — surfaced via the coverage strategy.
        exhaustive: false,
        limits: { maxBatchFiles: 200, maxRequestMs: 30000 },
      };
    },
    async collect(req) {
      return collectViaLsp({
        req, language: 'python', providerName: PROVIDER_NAME, providerVersion: PROVIDER_VERSION,
        spawnFor: (root) => (spawn && spawn(req)) || pythonSpawnFor(root),
        enumerateFiles: enumeratePyFiles,
        freshnessBasis: 'mtime', freshnessValue: '',
      });
    },
  };
}

export { enumeratePyFiles };
