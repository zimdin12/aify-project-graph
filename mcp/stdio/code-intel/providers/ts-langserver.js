// TypeScript / JavaScript code-intel provider (typescript-language-server).
//
// Thin wrapper over the shared LSP collection engine: supplies the spawn config
// (bundled npm server, project-local preferred), a first-party file enumerator,
// and a tsconfig-based freshness basis. Standard LSP, so the generic LspClient
// + collectViaLsp do the rest.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { nodeLspSpawn } from '../node-bin.js';
import { collectViaLsp } from './lsp-collect.js';
import { enumerateFirstPartyFiles } from '../enumerate-first-party.js';

const PROVIDER_NAME = 'ts-langserver';
const PROVIDER_VERSION = '0.1.0';

const EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

export function tsSpawnFor(projectRoot) {
  return nodeLspSpawn({ pkgName: 'typescript-language-server', binName: 'typescript-language-server', args: ['--stdio'], projectRoot });
}

// First-party walk. The exclusion set is DERIVED from the repo's own configuration by
// `enumerateFirstPartyFiles`; the hardcoded SKIP_DIRS that used to live here never mentioned
// `reference/` and put 1,196 nodes inside a gitignored tree. See that module's header.
function enumerateTsFiles(projectRoot, { maxFiles = 200 } = {}) {
  return enumerateFirstPartyFiles(projectRoot, {
    exts: EXTS,
    maxFiles,
    // Declaration-only files have no callsites to collect.
    skipFile: (name) => name.endsWith('.d.ts'),
  });
}

function tsconfigFreshness(projectRoot) {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const p = path.join(projectRoot, name);
    try {
      const st = fs.statSync(p);
      const h = crypto.createHash('sha256').update(`${name}:${st.mtimeMs}:${st.size}`).digest('hex').slice(0, 16);
      return { basis: 'tsconfig_hash', value: h };
    } catch { /* not present */ }
  }
  return { basis: 'mtime', value: '' };
}

export function createTsLangServerProvider({ spawn } = {}) {
  return {
    capabilities() {
      return {
        provider: PROVIDER_NAME, version: PROVIDER_VERSION,
        languages: ['typescript', 'javascript'],
        operations: ['definitions', 'references', 'hover', 'diagnostics', 'symbols'],
        freshnessBasis: 'tsconfig_hash', warmupRequired: false,
        limits: { maxBatchFiles: 200, maxRequestMs: 30000 },
      };
    },
    async collect(req) {
      const { basis, value } = tsconfigFreshness(req.projectRoot);
      return collectViaLsp({
        req, language: 'typescript', providerName: PROVIDER_NAME, providerVersion: PROVIDER_VERSION,
        spawnFor: (root) => (spawn && spawn(req)) || tsSpawnFor(root),
        enumerateFiles: enumerateTsFiles,
        freshnessBasis: basis, freshnessValue: value,
      });
    },
  };
}

export { enumerateTsFiles };
