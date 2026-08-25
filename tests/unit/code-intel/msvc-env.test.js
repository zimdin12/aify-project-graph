import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { discoverMsvcEnv, clangdChildEnv, findMsvcToolsets, findWindowsSdks } from '../../../mcp/stdio/code-intel/msvc-env.js';

const isWin = process.platform === 'win32';

// Measured 2026-08-25: a clangd with no MSVC environment returns an EMPTY caller set for any TU
// including a standard header, and reports status "ok" — 2 references vs 0 on identical TUs
// differing only by `#include <cstddef>`. Nearly every real C++ file includes one.

describe('discoverMsvcEnv', () => {
  it('is a no-op off win32 and says which reason', () => {
    const r = discoverMsvcEnv({ platform: 'linux', env: {} });
    expect(r.found).toBe(false);
    expect(r.reason).toBe('not_win32');
    expect(r.include).toBeNull();
  });

  it('defers to an operator-supplied INCLUDE rather than second-guessing a real vcvars shell', () => {
    const r = discoverMsvcEnv({ platform: 'win32', env: { INCLUDE: 'C:/some/real/vcvars/path' } });
    expect(r.found).toBe(true);
    expect(r.reason).toBe('inherited_from_environment');
    expect(r.include).toBe('C:/some/real/vcvars/path');
  });

  it('treats a blank INCLUDE as absent, not as an answer', () => {
    // A guard that accepts an empty value is the fail-open shape this repo keeps removing.
    const r = discoverMsvcEnv({ platform: 'win32', env: { INCLUDE: '   ' } });
    expect(r.reason).not.toBe('inherited_from_environment');
  });

  it('⭐ resolves the header clangd could not find — on a machine that has a toolset', () => {
    if (!isWin) return;
    const r = discoverMsvcEnv({ platform: 'win32', env: {} });
    if (!r.found) {
      // No toolset here. The contract is that it says so with a reason and offers no partial
      // INCLUDE — a half-resolved TU still yields an empty caller set and is harder to diagnose.
      expect(r.include).toBeNull();
      expect(r.reason).toMatch(/no_msvc_toolset|no_windows_sdk/);
      return;
    }
    // POSITIVE CONTROL: the discovered INCLUDE must actually contain <cstddef>.
    const dirs = r.include.split(';').filter(Boolean);
    const hit = dirs.find((d) => { try { return fs.statSync(path.join(d, 'cstddef')).isFile(); } catch { return false; } });
    expect(hit, 'discovered INCLUDE must resolve <cstddef>').toBeTruthy();

    // NEGATIVE CONTROL: it must not "resolve" a header that cannot exist.
    const bogus = dirs.find((d) => { try { return fs.statSync(path.join(d, '__zzz_not_a_header__')).isFile(); } catch { return false; } });
    expect(bogus).toBeUndefined();
  });
});

describe('findMsvcToolsets — capability, never name or recency', () => {
  it('every returned toolset has a READABLE probe header', () => {
    if (!isWin) return;
    // ⛔ THE BUG THIS ENCODES: `vswhere -latest` on this machine returns a BuildTools install with
    // NO C++ toolset — no VC/Tools/MSVC, no cl.exe, no vcvars64.bat — while the real toolset lives
    // in a Preview install under the other Program Files root. Two agents concluded "vcvars cannot
    // be captured here" from that. An install counts only when a header we need is readable in it.
    for (const t of findMsvcToolsets()) {
      expect(fs.statSync(path.join(t.includeDir, 'cstddef')).isFile()).toBe(true);
    }
  });

  it('every returned SDK carries all three sections clang-cl needs', () => {
    if (!isWin) return;
    for (const s of findWindowsSdks()) {
      expect(s.includeDirs).toHaveLength(3);
      for (const d of s.includeDirs) expect(fs.statSync(d).isDirectory()).toBe(true);
    }
  });
});

describe('clangdChildEnv', () => {
  it('leaves the base env untouched off win32 — no accidental INCLUDE on Linux', () => {
    const base = { PATH: '/usr/bin' };
    const { env, msvc } = clangdChildEnv({ base, platform: 'linux' });
    expect(env).toBe(base);
    expect(msvc.found).toBe(false);
  });

  it('does not overwrite an INCLUDE the operator already set', () => {
    const base = { INCLUDE: 'C:/operator/set/this' };
    const { env } = clangdChildEnv({ base, platform: 'win32' });
    expect(env.INCLUDE).toBe('C:/operator/set/this');
  });

  it('adds INCLUDE when it discovered one, and preserves the rest of the env', () => {
    if (!isWin) return;
    const base = { ...process.env, APG_TEST_MARKER: 'kept' };
    delete base.INCLUDE;
    const { env, msvc } = clangdChildEnv({ base, platform: 'win32' });
    expect(env.APG_TEST_MARKER).toBe('kept');
    if (msvc.found) expect(env.INCLUDE).toBeTruthy();
    else expect(env.INCLUDE).toBeUndefined();   // fails closed rather than inventing a path
  });
});
