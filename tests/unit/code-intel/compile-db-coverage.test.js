import { describe, it, expect } from 'vitest';
import { computeCompileDbCoverage } from '../../../mcp/stdio/code-intel/compile-db.js';

// The coverage verdict gates the false-exhaustive guard. Test the decision logic
// directly by injecting `prepared` flags (no real compile DB / clangd needed).
const prep = (over) => ({ found: true, foreignToolchain: false, unity: false, unityExpanded: false, dbHash: Math.random().toString(36), ...over });

describe('computeCompileDbCoverage — trustworthy-for-exhaustive verdict', () => {
  it('native, non-unity DB → complete (exhaustive allowed)', () => {
    const c = computeCompileDbCoverage({ projectRoot: '/x', prepared: prep({}), env: {} });
    expect(c.complete).toBe(true);
    expect(c.reason).toBeNull();
  });

  it('foreign (Linux/WSL) DB on host clangd → NOT complete (the false-exhaustive cause)', () => {
    const c = computeCompileDbCoverage({ projectRoot: '/x', prepared: prep({ foreignToolchain: true }), env: {} });
    expect(c.complete).toBe(false);
    expect(c.foreignToolchain).toBe(true);
    expect(c.reason).toMatch(/foreign|Linux\/WSL|partial|APG_CLANGD_WSL/i);
  });

  it('foreign DB BUT WSL-clangd active → complete (clangd runs under WSL on the native DB)', () => {
    const c = computeCompileDbCoverage({ projectRoot: '/x', prepared: prep({ foreignToolchain: true }), env: { APG_CLANGD_WSL: '1' } });
    expect(c.complete).toBe(true);
  });

  it('unity build NOT expanded → NOT complete (per-source TUs absent)', () => {
    const c = computeCompileDbCoverage({ projectRoot: '/x', prepared: prep({ unity: true, unityExpanded: false }), env: {} });
    expect(c.complete).toBe(false);
    expect(c.unityUnexpanded).toBe(true);
    expect(c.reason).toMatch(/unity/i);
  });

  it('unity build EXPANDED (native) → complete', () => {
    const c = computeCompileDbCoverage({ projectRoot: '/x', prepared: prep({ unity: true, unityExpanded: true }), env: {} });
    expect(c.complete).toBe(true);
  });

  it('no compile DB found → NOT complete (no index, never exhaustive)', () => {
    const c = computeCompileDbCoverage({ projectRoot: '/x', prepared: { found: false }, env: {} });
    expect(c.complete).toBe(false);
    expect(c.reason).toMatch(/no compile_commands|no index/i);
  });

  it('no projectRoot → NOT complete (safe under-claim)', () => {
    expect(computeCompileDbCoverage({}).complete).toBe(false);
  });

  // The verdict is cached per projectRoot keyed on dbHash. A DB change (new
  // dbHash) MUST recompute the flags, not serve a stale verdict.
  it('cache invalidates when dbHash changes for the same projectRoot', () => {
    const root = '/cache-test-repo';
    const first = computeCompileDbCoverage({ projectRoot: root, prepared: { found: true, foreignToolchain: true, unity: false, unityExpanded: false, dbHash: 'hash-A' }, env: {} });
    expect(first.complete).toBe(false);
    expect(first.foreignToolchain).toBe(true);
    // Same projectRoot, NEW dbHash, now native — verdict must flip, not stick.
    const second = computeCompileDbCoverage({ projectRoot: root, prepared: { found: true, foreignToolchain: false, unity: false, unityExpanded: false, dbHash: 'hash-B' }, env: {} });
    expect(second.complete).toBe(true);
    expect(second.foreignToolchain).toBe(false);
  });

  it('WSL-mode verdict is derived fresh per call even on a cache hit (same dbHash)', () => {
    const root = '/cache-test-repo-wsl';
    const prepared = { found: true, foreignToolchain: true, unity: false, unityExpanded: false, dbHash: 'hash-WSL' };
    expect(computeCompileDbCoverage({ projectRoot: root, prepared, env: {} }).complete).toBe(false);
    // Same cached flags (same dbHash), but APG_CLANGD_WSL flips the env verdict.
    expect(computeCompileDbCoverage({ projectRoot: root, prepared, env: { APG_CLANGD_WSL: '1' } }).complete).toBe(true);
  });
});
