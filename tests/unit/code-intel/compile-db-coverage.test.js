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
});
