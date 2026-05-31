// clangd binary resolution + spawn-arg builder (Code-Intel v2 L1).
//
// clangd is frequently NOT on PATH on the game-dev workstations (Windows
// installs LLVM under `C:/Program Files/LLVM/bin`). Resolution precedence:
//   1. APG_CLANGD env var (explicit override) — if set AND the file exists.
//   2. win32: `C:/Program Files/LLVM/bin/clangd.exe` — if it exists.
//   3. `clangd` on PATH (fallback; may still fail to spawn — callers handle
//      ENOENT via the LspClient start() rejection path).

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { withHidden } from '../util/exec.js';

const WIN_LLVM_CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';

/**
 * Resolve the clangd command to spawn.
 * @returns {{ command: string, source: 'env'|'win32-llvm'|'path' }}
 */
export function resolveClangd() {
  const envOverride = process.env.APG_CLANGD;
  if (envOverride && fs.existsSync(envOverride)) {
    return { command: envOverride, source: 'env' };
  }
  if (process.platform === 'win32' && fs.existsSync(WIN_LLVM_CLANGD)) {
    return { command: WIN_LLVM_CLANGD, source: 'win32-llvm' };
  }
  return { command: 'clangd', source: 'path' };
}

/**
 * Run `<command> --version` and return the first version line, or null if the
 * binary can't be executed. Uses windowsHide to avoid console flashes.
 * @param {string} command
 * @returns {string|null}
 */
export function clangdVersion(command) {
  try {
    const out = spawnSync(command, ['--version'], withHidden({ encoding: 'utf8' }));
    if (out.error || out.status !== 0) return null;
    const line = String(out.stdout || out.stderr || '').split(/\r?\n/u)[0].trim();
    return line || null;
  } catch {
    return null;
  }
}

/**
 * Build the clangd spawn config (command + tuned args) for the L1 foundation.
 * Background index ON, in-memory PCH, bounded parallelism, large result cap,
 * and — when a normalized compile DB exists — point clangd at its directory.
 *
 * Overridable: tests inject their own `spawn` and bypass this entirely.
 *
 * @param {object} opts
 * @param {string} [opts.projectRoot]
 * @param {object} [opts.compileDb] result of prepareCompileDb (uses
 *   normalizedDir when present)
 * @returns {{ command: string, args: string[] }}
 */
export function buildClangdSpawn({ compileDb } = {}) {
  const { command } = resolveClangd();
  const args = [
    '--background-index',
    '--background-index-priority=normal',
    '--pch-storage=memory',
    '-j=4',
    '--limit-results=2000',
    // P0-3: foreign (Linux/WSL) compile DBs name a POSIX compiler driver
    // (`/usr/bin/c++`). `--query-driver=*` lets clangd interrogate whatever
    // driver an entry names (and a host compiler if present) to discover its
    // system include paths, instead of hard-failing the stdlib lookup. Harmless
    // on native DBs (clangd only queries drivers actually referenced).
    '--query-driver=*'
  ];
  if (compileDb && compileDb.found && compileDb.normalizedDir) {
    args.push(`--compile-commands-dir=${compileDb.normalizedDir}`);
  }
  return { command, args };
}
