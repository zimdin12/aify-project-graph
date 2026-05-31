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
import { hostToWsl } from './compile-db.js';

const WIN_LLVM_CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';

// Default clangd binary INSIDE WSL. Overridable via APG_CLANGD_WSL_BIN for
// distros that install it elsewhere (e.g. /usr/lib/llvm-18/bin/clangd).
const WSL_CLANGD_BIN_DEFAULT = 'clangd';

/**
 * Is the opt-in WSL-clangd transport explicitly requested? Strictly opt-in:
 * only `APG_CLANGD_WSL` set to a truthy value (`1`/`true`/`on`/`yes`) turns it
 * on. Everything else (unset, `0`, `false`) leaves the default Windows-clangd
 * path untouched.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function wslModeRequested(env = process.env) {
  const raw = String(env?.APG_CLANGD_WSL ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

/**
 * Detect whether WSL is present AND has a runnable clangd. Cheap, cached per
 * process (the probe spawns `wsl.exe -e <bin> --version`). Only meaningful on
 * win32 — returns { available:false } elsewhere. `spawnImpl` is injectable so
 * tests never touch real WSL.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(cmd:string,args:string[],opts:object)=>{status:number|null,error?:Error,stdout?:string,stderr?:string}} [opts.spawnImpl]
 * @returns {{ available: boolean, version: string|null, bin: string, reason?: string }}
 */
let _wslProbeCache = null;
export function detectWslClangd({ env = process.env, spawnImpl = spawnSync } = {}) {
  if (process.platform !== 'win32') {
    return { available: false, version: null, bin: '', reason: 'not_win32' };
  }
  // Cache only the no-injection production probe (tests pass a spawnImpl and
  // bypass the cache so each assertion is deterministic).
  const useCache = spawnImpl === spawnSync;
  if (useCache && _wslProbeCache) return _wslProbeCache;
  const bin = env?.APG_CLANGD_WSL_BIN || WSL_CLANGD_BIN_DEFAULT;
  let result;
  try {
    const out = spawnImpl('wsl.exe', ['-e', bin, '--version'], withHidden({ encoding: 'utf8', timeout: 8000 }));
    if (out.error || out.status !== 0) {
      result = { available: false, version: null, bin, reason: out.error ? String(out.error.code || out.error.message) : `exit_${out.status}` };
    } else {
      const line = String(out.stdout || out.stderr || '').split(/\r?\n/u)[0].trim();
      result = { available: true, version: line || null, bin };
    }
  } catch (err) {
    result = { available: false, version: null, bin, reason: String(err?.code || err?.message || 'spawn_failed') };
  }
  if (useCache) _wslProbeCache = result;
  return result;
}

// Test-only: clear the cached WSL probe so a test can re-probe with a fresh
// (mocked or real) result.
export function _resetWslProbeCache() { _wslProbeCache = null; }

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

// The tuned clangd flags shared by both transports.
const BASE_CLANGD_ARGS = [
  '--background-index',
  '--background-index-priority=normal',
  '--pch-storage=memory',
  '-j=4',
  '--limit-results=2000'
];

/**
 * Decide whether the WSL-clangd transport should be used for this spawn.
 * Strictly additive: only ON when (a) `APG_CLANGD_WSL=1` is set OR (b) auto is
 * enabled AND a foreign/Linux compile DB was detected on win32, AND in BOTH
 * cases WSL+clangd is actually available. Default OFF. Auto-enable is itself
 * opt-in via `APG_CLANGD_WSL=auto` (default-off to stay safe), so an unset env
 * NEVER changes the existing Windows path.
 *
 * @param {object} opts
 * @param {object} [opts.compileDb] prepareCompileDb result
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(o?:object)=>{available:boolean,version:string|null,bin:string}} [opts.detect]
 *   WSL detector (injectable for tests)
 * @returns {{ use: boolean, reason: string, wsl?: {available:boolean,version:string|null,bin:string} }}
 */
export function decideWslMode({ compileDb, env = process.env, detect = detectWslClangd } = {}) {
  const raw = String(env?.APG_CLANGD_WSL ?? '').trim().toLowerCase();
  const explicit = raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
  const auto = raw === 'auto';
  if (!explicit && !auto) return { use: false, reason: 'not_requested' };
  if (process.platform !== 'win32') return { use: false, reason: 'not_win32' };
  // Auto mode only kicks in for a foreign (Linux/WSL-built) DB — a native
  // Windows DB has no reason to detour through WSL.
  if (auto && !(compileDb && compileDb.foreignToolchain)) {
    return { use: false, reason: 'auto_native_db' };
  }
  const wsl = detect({ env });
  if (!wsl.available) return { use: false, reason: 'wsl_unavailable', wsl };
  return { use: true, reason: explicit ? 'opt_in_explicit' : 'auto_foreign_db', wsl };
}

/**
 * Build the clangd spawn config (command + tuned args) for the L1 foundation.
 * Background index ON, in-memory PCH, bounded parallelism, large result cap,
 * and — when a compile DB exists — point clangd at its directory.
 *
 * Two transports:
 *  - DEFAULT (Windows clangd): unchanged. `--query-driver=*` + the WSL→host
 *    NORMALIZED DB dir. References/hierarchy work; foreign-DB diagnostics/hover
 *    are degraded (bogus stdlib cascade).
 *  - WSL (opt-in via APG_CLANGD_WSL): launch clangd UNDER WSL
 *    (`wsl.exe -e clangd …`) pointed at the ORIGINAL Linux DB dir
 *    (e.g. `…/build-linux`, mapped to `/mnt/c/...`). NO Windows normalization,
 *    NO `--query-driver` (the real Linux toolchain resolves natively). The
 *    returned `pathMode:'wsl'` signals the LspClient to translate file URIs
 *    host↔WSL.
 *
 * Overridable: tests inject their own `spawn` and bypass this entirely.
 *
 * @param {object} opts
 * @param {string} [opts.projectRoot]
 * @param {object} [opts.compileDb] result of prepareCompileDb
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(o?:object)=>{available:boolean,version:string|null,bin:string}} [opts.detect]
 * @returns {{ command: string, args: string[], pathMode?: 'wsl', wsl?: object }}
 */
export function buildClangdSpawn({ compileDb, env = process.env, detect = detectWslClangd } = {}) {
  const decision = decideWslMode({ compileDb, env, detect });

  if (decision.use) {
    // WSL transport. Point clangd at the ORIGINAL (un-normalized) DB dir so the
    // Linux `/mnt/c/...` paths + Linux toolchain are consumed as-is. The dir is
    // a Windows path here (e.g. `C:/Users/.../build-linux`); translate it to its
    // WSL form for the flag.
    const wslBin = decision.wsl?.bin || 'clangd';
    const args = ['-e', wslBin, ...BASE_CLANGD_ARGS];
    // NOTE: no `--query-driver` — the Linux DB names the real Linux compiler,
    // which exists in WSL, so clangd discovers the stdlib natively.
    if (compileDb && compileDb.found && compileDb.sourceDir) {
      args.push(`--compile-commands-dir=${hostToWsl(compileDb.sourceDir)}`);
    }
    return { command: 'wsl.exe', args, pathMode: 'wsl', wsl: decision.wsl };
  }

  // DEFAULT Windows transport (unchanged behaviour).
  const { command } = resolveClangd();
  const args = [
    ...BASE_CLANGD_ARGS,
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
