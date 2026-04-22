// Self-healing native-module preflight.
//
// Problem: `better-sqlite3` is a compiled native module. Its `.node` binary
// is platform-specific (Windows .node ≠ Linux .so). In the common case where
// one repo checkout is used from multiple platforms (Windows + WSL, or two
// machines sharing a mounted clone), `npm rebuild` on one side leaves the
// other side with `ERR_DLOPEN_FAILED` / "not a valid Win32 application".
//
// Solution: on server startup, probe the native module. If it fails to load
// with a known platform-mismatch signature, run `npm rebuild better-sqlite3`
// once (synchronously), log what we did, and continue. Failures that aren't
// platform-mismatch propagate unchanged so we don't mask real bugs.
//
// This runs BEFORE any code that imports Database, so the main server import
// chain sees a working module.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
// mcp/stdio/ → ../.. = repo root where package.json lives
const packageRoot = join(here, '..', '..');

const PLATFORM_MISMATCH_PATTERNS = [
  /not a valid Win32 application/i,
  /invalid ELF header/i,
  /wrong ELF class/i,
  /cannot execute binary file/i,
  /ERR_DLOPEN_FAILED/,
];

function isPlatformMismatch(err) {
  const msg = (err?.message || String(err));
  return PLATFORM_MISMATCH_PATTERNS.some((p) => p.test(msg));
}

function tryLoad() {
  try {
    // `better-sqlite3` defers binding load until Database construction, so a
    // plain require() is not enough to detect cross-platform binary flips.
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
}

function rebuild() {
  const result = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
    cwd: packageRoot,
    stdio: 'pipe',
    shell: true, // Windows needs shell:true for npm.cmd resolution
    encoding: 'utf8',
  });
  return result;
}

function evict() {
  // Ensure the next require() goes to disk instead of returning the cached
  // failed module record. The failed load left an entry in require.cache.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('better-sqlite3') || key.includes('bindings')) {
      delete require.cache[key];
    }
  }
}

const first = tryLoad();
if (!first.ok) {
  if (isPlatformMismatch(first.err)) {
    // eslint-disable-next-line no-console
    console.error('[preflight] better-sqlite3 native binary is from another platform; running npm rebuild once...');
    const r = rebuild();
    if (r.status !== 0) {
      // eslint-disable-next-line no-console
      console.error('[preflight] npm rebuild better-sqlite3 failed:', r.stderr?.slice?.(-500) || r.error?.message);
      throw first.err; // surface the original error — nothing we can do
    }
    evict();
    const second = tryLoad();
    if (!second.ok) {
      // eslint-disable-next-line no-console
      console.error('[preflight] native module still not loadable after rebuild. Giving up.');
      throw second.err;
    }
    // eslint-disable-next-line no-console
    console.error('[preflight] better-sqlite3 rebuilt for this platform; continuing.');
  } else {
    // Not a platform issue — propagate so real problems aren't masked.
    throw first.err;
  }
}
