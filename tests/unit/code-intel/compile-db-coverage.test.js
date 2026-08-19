import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeCompileDbCoverage } from '../../../mcp/stdio/code-intel/compile-db.js';

// The coverage verdict gates the false-exhaustive guard. Test the decision logic
// directly by injecting `prepared` flags (no real compile DB / clangd needed).
//
// `firstPartyCount` defaults to a non-zero value because the real
// prepareCompileDb ALWAYS reports it (compile-db.js:711) — a stub without it
// would not represent any reachable state. The zero case is its own test below
// (P0-1: a DB covering no first-party code can never license exhaustive).
//
// ⚠ THE ROOT USED TO BE THE LITERAL STRING '/x', AND THAT MADE THESE TESTS INCOHERENT. The stub
// claims five first-party DB entries while the on-disk census of a non-existent directory finds
// ZERO sources — a state that cannot occur in production, and one where coverage is not merely
// low but UNMEASURABLE. The old code let an unmeasurable census pass through to `complete:true`,
// so these tests were green because of a fail-open default rather than because the gate they
// name was working.
// ⇒ Each test now runs against a REAL temp repo whose disk sources and compile DB agree, so the
// foreign/unity/first-party gate under test is the only thing that can decide the verdict.
let repo;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cov-'));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  const buildDir = path.join(repo, 'build-win-clangd');
  fs.mkdirSync(buildDir, { recursive: true });
  const entries = [];
  for (let i = 0; i < 5; i += 1) {
    fs.writeFileSync(path.join(repo, 'src', `f${i}.cpp`), 'void f(){}\n');
    entries.push({
      directory: buildDir.split(path.sep).join('/'),
      file: path.join(repo, 'src', `f${i}.cpp`).split(path.sep).join('/'),
      command: `clang-cl -c f${i}.cpp`,
    });
  }
  fs.writeFileSync(path.join(buildDir, 'compile_commands.json'), JSON.stringify(entries, null, 2));
});
afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* win lock */ } });

// ⚠ `normalizedPath` must point at the REAL compile_commands.json written above. Without it
// the DB file-set parse yields nothing, coverage computes "0 of ~5", and the test measures a
// broken stub instead of the gate it names.
const prep = (over) => ({
  found: true, foreignToolchain: false, unity: false, unityExpanded: false, firstPartyCount: 5,
  dbHash: Math.random().toString(36),
  normalizedPath: path.join(repo, 'build-win-clangd', 'compile_commands.json'),
  ...over,
});

describe('computeCompileDbCoverage — trustworthy-for-exhaustive verdict', () => {
  it('native, non-unity DB → complete (exhaustive allowed)', () => {
    const c = computeCompileDbCoverage({ projectRoot: repo, prepared: prep({}), env: {} });
    expect(c.complete).toBe(true);
    expect(c.reason).toBeNull();
  });

  it('foreign (Linux/WSL) DB on host clangd → NOT complete (the false-exhaustive cause)', () => {
    const c = computeCompileDbCoverage({ projectRoot: repo, prepared: prep({ foreignToolchain: true }), env: {} });
    expect(c.complete).toBe(false);
    expect(c.foreignToolchain).toBe(true);
    expect(c.reason).toMatch(/foreign|Linux\/WSL|partial|APG_CLANGD_WSL/i);
  });

  it('foreign DB BUT WSL-clangd active → complete (clangd runs under WSL on the native DB)', () => {
    const c = computeCompileDbCoverage({ projectRoot: repo, prepared: prep({ foreignToolchain: true }), env: { APG_CLANGD_WSL: '1' } });
    expect(c.complete).toBe(true);
  });

  it('unity build NOT expanded → NOT complete (per-source TUs absent)', () => {
    const c = computeCompileDbCoverage({ projectRoot: repo, prepared: prep({ unity: true, unityExpanded: false }), env: {} });
    expect(c.complete).toBe(false);
    expect(c.unityUnexpanded).toBe(true);
    expect(c.reason).toMatch(/unity/i);
  });

  it('unity build EXPANDED (native) → complete', () => {
    const c = computeCompileDbCoverage({ projectRoot: repo, prepared: prep({ unity: true, unityExpanded: true }), env: {} });
    expect(c.complete).toBe(true);
  });

  // P0-1 (sand_castle 2026-07-26): a native, non-unity DB whose entries are all
  // third-party/_deps. Neither the foreign nor the unity gate fires, yet clangd
  // has no compile command for any first-party file.
  it('zero first-party entries → NOT complete even when native and non-unity', () => {
    const c = computeCompileDbCoverage({ projectRoot: repo, prepared: prep({ firstPartyCount: 0 }), env: {} });
    expect(c.complete).toBe(false);
    expect(c.noFirstParty).toBe(true);
    expect(c.foreignToolchain).toBe(false);
    expect(c.unityUnexpanded).toBe(false);
    expect(c.reason).toMatch(/first-party/i);
  });

  it('no compile DB found → NOT complete (no index, never exhaustive)', () => {
    const c = computeCompileDbCoverage({ projectRoot: repo, prepared: { found: false }, env: {} });
    expect(c.complete).toBe(false);
    expect(c.reason).toMatch(/no compile_commands|no index/i);
  });

  it('no projectRoot → NOT complete (safe under-claim)', () => {
    expect(computeCompileDbCoverage({}).complete).toBe(false);
  });

  // The verdict is cached per projectRoot keyed on dbHash. A DB change (new
  // dbHash) MUST recompute the flags, not serve a stale verdict.
  it('cache invalidates when dbHash changes for the same projectRoot', () => {
    const root = repo;
    const first = computeCompileDbCoverage({ projectRoot: root, prepared: prep({ foreignToolchain: true, dbHash: 'hash-A' }), env: {} });
    expect(first.complete).toBe(false);
    expect(first.foreignToolchain).toBe(true);
    // Same projectRoot, NEW dbHash, now native — verdict must flip, not stick.
    const second = computeCompileDbCoverage({ projectRoot: root, prepared: prep({ dbHash: 'hash-B' }), env: {} });
    expect(second.complete).toBe(true);
    expect(second.foreignToolchain).toBe(false);
  });

  it('WSL-mode verdict is derived fresh per call even on a cache hit (same dbHash)', () => {
    const root = repo;
    const prepared = prep({ foreignToolchain: true, dbHash: 'hash-WSL' });
    expect(computeCompileDbCoverage({ projectRoot: root, prepared, env: {} }).complete).toBe(false);
    // Same cached flags (same dbHash), but APG_CLANGD_WSL flips the env verdict.
    expect(computeCompileDbCoverage({ projectRoot: root, prepared, env: { APG_CLANGD_WSL: '1' } }).complete).toBe(true);
  });
});
