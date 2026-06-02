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

const PROVIDER_NAME = 'ts-langserver';
const PROVIDER_VERSION = '0.1.0';

const EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.cache', 'vendor']);

export function tsSpawnFor(projectRoot) {
  return nodeLspSpawn({ pkgName: 'typescript-language-server', binName: 'typescript-language-server', args: ['--stdio'], projectRoot });
}

// Recursive first-party walk, skipping vendored / build output dirs.
function enumerateTsFiles(projectRoot, { maxFiles = 200 } = {}) {
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
        const ext = path.extname(ent.name).toLowerCase();
        if (!EXTS.has(ext)) continue;
        if (ent.name.endsWith('.d.ts')) continue; // declaration-only, no callsites
        scanned += 1;
        files.push(path.relative(projectRoot, path.join(dir, ent.name)).replace(/\\/g, '/'));
      }
    }
  };
  walk(projectRoot);
  return { files, stats: { total: scanned, after_filter: files.length, truncated, max_files: maxFiles } };
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
