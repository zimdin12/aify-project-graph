// Python code-intel provider (pyright-langserver).
//
// Thin wrapper over the shared LSP collection engine. Pyright speaks standard
// LSP (references, definition, hover, documentSymbol, callHierarchy). The honest
// caveat — Python call resolution is never provably exhaustive (duck typing,
// getattr, dynamic dispatch, monkeypatching) — is expressed by the python
// coverage strategy (code-intel/coverage.js), so the verbs always degrade a
// Python caller set to a FLOOR rather than "safe to delete".

import { nodeLspSpawn } from '../node-bin.js';
import { collectViaLsp } from './lsp-collect.js';
import { enumerateFirstPartyFiles } from '../enumerate-first-party.js';

const PROVIDER_NAME = 'pyright';
const PROVIDER_VERSION = '0.1.0';

const EXTS = new Set(['.py', '.pyi']);
// Python-specific ADDITIONS to the derived exclusion set — never a replacement for it. These are
// real Python concerns that a generic .gitignore may not name; everything else (node_modules,
// build output, and this repo's `reference/`) comes from the repository's own configuration.
const PY_EXTRA_SKIP_DIRS = ['site-packages', '.mypy_cache'];

export function pythonSpawnFor(projectRoot) {
  return nodeLspSpawn({ pkgName: 'pyright', binName: 'pyright-langserver', args: ['--stdio'], projectRoot });
}

function enumeratePyFiles(projectRoot, { maxFiles = 200 } = {}) {
  return enumerateFirstPartyFiles(projectRoot, {
    exts: EXTS, maxFiles, extraSkipDirs: PY_EXTRA_SKIP_DIRS,
  });
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
