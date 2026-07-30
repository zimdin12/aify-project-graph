// A PATH LOOKUP ANSWERS THE WRONG QUESTION.
//
// The FOREIGN compile-db banner recommends building a native Windows compile DB
// with clang-cl. We gated that recommendation on clang-cl's availability — using a
// bare PATH probe (`where clang-cl`).
//
// A field tester first reported "clang-cl NOT FOUND", we shipped the gate on that,
// and he then corrected himself: clang-cl.exe was present at C:/Program
// Files/LLVM/bin the whole time — a full LLVM 22.1.6 install, simply not on PATH.
// His own diagnosis is the right one: he reported a PATH fact as a HOST fact, and
// so did our probe.
//
// The consequence of believing it was WORSE than the original bug. Before the gate,
// the banner always recommended the native recipe — correct on that host. Gated on
// PATH, it would have DEMOTED a correctly-equipped Windows machine to the slower WSL
// fallback. A detection that fails toward the worse remedy is not a safe default;
// it is a wrong answer delivered confidently.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveClangCl } from '../../../mcp/stdio/code-intel/resolve-clangd.js';

describe('resolveClangCl', () => {
  it('finds clang-cl next to a configured APG_CLANGD, without consulting PATH', () => {
    // The real echoes configuration: .mcp.json pins
    // APG_CLANGD=C:/Program Files/LLVM/bin/clangd.exe, so clang-cl is its sibling.
    // Pinning the toolchain directory is a stronger signal than PATH membership.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-clangcl-'));
    try {
      const exe = process.platform === 'win32' ? 'clang-cl.exe' : 'clang-cl';
      fs.writeFileSync(path.join(dir, exe), '');
      const found = resolveClangCl({ APG_CLANGD: path.join(dir, 'clangd.exe') });
      expect(found).toBeTruthy();
      expect(found.source).toBe('install-dir');
      expect(found.command).toContain('clang-cl');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null rather than a false positive when it genuinely is not there', () => {
    // The guard must not over-correct into always claiming availability — that
    // would restore the original bug of recommending a recipe nobody can run.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-noclangcl-'));
    try {
      const found = resolveClangCl({ APG_CLANGD: path.join(dir, 'clangd.exe'), PATH: dir });
      // On a host with a real LLVM install the install-dir probe may still find
      // it; what must never happen is a claim based on the empty directory.
      if (found) expect(found.command).not.toContain(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probes install-dir BEFORE PATH, so an off-PATH install still counts', () => {
    // Ordering is the whole fix: PATH-first would have returned null on the host
    // that reported this, because the install was never on PATH.
    const src = fs.readFileSync(
      new URL('../../../mcp/stdio/code-intel/resolve-clangd.js', import.meta.url),
      'utf8',
    );
    const fn = src.slice(src.indexOf('export function resolveClangCl'));
    const installIdx = fn.indexOf('existsSync');
    const pathIdx = fn.indexOf("'where'");
    expect(installIdx).toBeGreaterThan(-1);
    expect(pathIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeLessThan(pathIdx);
  });

  it('health consults the resolver, not a PATH probe', () => {
    const health = fs.readFileSync(
      new URL('../../../mcp/stdio/query/verbs/health.js', import.meta.url),
      'utf8',
    );
    expect(health).toMatch(/const clangCl = resolveClangCl\(\);/);
    expect(health).toMatch(/codeIntel\.clangClAvailable = Boolean\(clangCl\)/);
    // The dead PATH helper must be gone, not merely unused.
    expect(health).not.toMatch(/^function hasOnPath\(/m);
  });

  it('the emitted recipe is runnable as written, not correct-in-outline', () => {
    // The one-liner we shipped first FAILS on a standard Windows host: CMake's
    // compiler test LINKS, the link invokes `rc` (Windows SDK, off-PATH outside a
    // vcvars shell), and overriding only CXX leaves a C+CXX project without a C
    // compiler. clang-cl compiled fine both times; the configure still aborted.
    const health = fs.readFileSync(
      new URL('../../../mcp/stdio/query/verbs/health.js', import.meta.url),
      'utf8',
    );
    expect(health).toMatch(/CMAKE_C_COMPILER/);
    expect(health).toMatch(/CMAKE_RC_COMPILER/);
    expect(health).toMatch(/llvm-rc\.exe/);
    // And it must say WHY those are there, or the next reader drops them.
    expect(health).toMatch(/compiler test links/);
    // The link gate is skipped outright — a compile DB needs compile lines, not a
    // binary. This is the "compile lines, not a binary" principle as a flag.
    expect(health).toMatch(/CMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY/);
  });

  it('does NOT present a foreign DB as user misconfiguration', () => {
    // CMAKE_EXPORT_COMPILE_COMMANDS is supported only by the Makefile/Ninja
    // generators, so a Windows project built with the Visual Studio generator
    // CANNOT emit a compile DB at all — the Linux/WSL one may be the only one that
    // exists. Telling that user to "FIX" their setup sends them to repair something
    // that is not broken, which is the same failure as naming an unverified cause.
    const health = fs.readFileSync(
      new URL('../../../mcp/stdio/query/verbs/health.js', import.meta.url),
      'utf8',
    );
    expect(health).toMatch(/CANNOT emit compile_commands\.json/);
    expect(health).toMatch(/usually not a misconfiguration/);
    // And the real cost must be stated: a second configure, not a flag.
    expect(health).toMatch(/a SECOND configure alongside your real build/);
    // The no-rebuild path must be offered, since it is cheaper than a second build.
    expect(health).toMatch(/CHEAPER ALTERNATIVE: APG_CLANGD_WSL=1/);
  });
});
