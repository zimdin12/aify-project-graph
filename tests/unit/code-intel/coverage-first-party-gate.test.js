// P0-1 — the compile DB must prove it covers YOUR code, not merely that it is
// native and non-unity.
//
// Measured on sand_castle (2026-07-26): all FIVE compile databases contained
// 441-512 entries and ZERO first-party ones — every entry was `_deps/`
// third-party (SDL3). Their CMake exports compile commands for dependencies but
// not their own sources, so clangd had no compile command for any first-party
// file. `code_intel_references` then returned 3 of 8 real call sites while
// reporting exhaustive:true, because coverage only asked
// `!foreignBlocking && !unityUnexpanded`.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeCompileDbCoverage } from '../../../mcp/stdio/code-intel/compile-db.js';

const isWin = process.platform === 'win32';

function hostPath(dir, rel) {
  return path.join(dir, rel).replace(/\\/g, '/');
}

describe('compile-DB coverage requires first-party coverage', () => {
  let repo;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-fpgate-'));
    fs.mkdirSync(path.join(repo, 'sim'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'sim', 'Terrain.cpp'), 'void t(){}\n');
  });
  afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch {} });

  function writeDb(rel, entries) {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(entries, null, 2));
    return p;
  }

  // The exact sand_castle shape: a native, non-unity DB full of _deps entries
  // and not one line of the project's own code.
  it('reports NOT complete when the DB has zero first-party entries', () => {
    const buildDir = hostPath(repo, 'build-win-clangd');
    writeDb('build-win-clangd/compile_commands.json', [
      {
        directory: buildDir,
        file: hostPath(repo, 'build-win-clangd/_deps/sdl3-build/CMakeFiles/SDL3-static.dir/pch.c'),
        command: 'clang-cl -c pch.c',
      },
      {
        directory: buildDir,
        file: hostPath(repo, 'build-win-clangd/_deps/sdl3-src/src/audio/SDL_audio.c'),
        command: 'clang-cl -c SDL_audio.c',
      },
    ]);

    const cov = computeCompileDbCoverage({ projectRoot: repo, env: {} });

    expect(cov.complete).toBe(false);
    expect(cov.firstPartyCount).toBe(0);
    // The reason must name the ACTUAL fix — exporting first-party compile
    // commands — not the foreign/unity remedies, which do not apply here.
    expect(cov.reason).toMatch(/first-party/i);
    expect(cov.reason).toMatch(/CMAKE_EXPORT_COMPILE_COMMANDS|export compile commands/i);
    // It is neither foreign nor unity — proving those gates would NOT have caught it.
    expect(cov.foreignToolchain).toBe(false);
    expect(cov.unityUnexpanded).toBe(false);
  });

  it('still reports complete for a DB that does cover first-party sources', () => {
    const buildDir = hostPath(repo, 'build-win-clangd');
    writeDb('build-win-clangd/compile_commands.json', [
      {
        directory: buildDir,
        file: hostPath(repo, 'sim/Terrain.cpp'),
        command: `clang-cl -c ${hostPath(repo, 'sim/Terrain.cpp')}`,
      },
      {
        directory: buildDir,
        file: hostPath(repo, 'build-win-clangd/_deps/sdl3-src/src/audio/SDL_audio.c'),
        command: 'clang-cl -c SDL_audio.c',
      },
    ]);

    const cov = computeCompileDbCoverage({ projectRoot: repo, env: {} });

    expect(cov.complete).toBe(true);
    expect(cov.firstPartyCount).toBe(1);
    expect(cov.reason).toBeNull();
  });

  it('reports NOT complete when the queried SOURCE file has no entry in the DB', () => {
    // The DB must cover the repo WELL overall, so the ratio gate passes and the
    // PER-FILE gate is what fires — otherwise this would just re-test the ratio.
    const buildDir = hostPath(repo, 'build-win-clangd');
    const entries = [];
    for (let i = 0; i < 30; i++) {
      fs.writeFileSync(path.join(repo, 'sim', `Other${i}.cpp`), `void o${i}(){}\n`);
      entries.push({
        directory: buildDir,
        file: hostPath(repo, `sim/Other${i}.cpp`),
        command: `clang-cl -c ${hostPath(repo, `sim/Other${i}.cpp`)}`,
      });
    }
    writeDb('build-win-clangd/compile_commands.json', entries);

    // 30 of 31 sources covered (97%) — the ratio is fine, but the queried file
    // itself has no compile command.
    const cov = computeCompileDbCoverage({ projectRoot: repo, file: 'sim/Terrain.cpp', env: {} });

    expect(cov.poorlyCovered).toBe(false);
    expect(cov.fileUncovered).toBe(true);
    expect(cov.complete).toBe(false);
    expect(cov.reason).toMatch(/no compile command|not in the compile/i);
  });

  // H1 (adversarial review): a bare `firstPartyCount > 0` check let a DB
  // exporting ONE source out of hundreds claim full coverage — the same silent
  // truncation as exporting none. Worse, headers were exempt from the per-file
  // gate entirely, and C++ declarations live in headers, so the exempt path was
  // the normal path: the field-report failure verbatim.
  it('reports NOT complete when the DB covers only a tiny share of first-party sources', () => {
    const buildDir = hostPath(repo, 'build');
    for (let i = 0; i < 40; i++) {
      fs.writeFileSync(path.join(repo, 'sim', `f${i}.cpp`), `void f${i}(){}\n`);
    }
    writeDb('build/compile_commands.json', [{
      directory: buildDir,
      file: hostPath(repo, 'sim/f0.cpp'),
      command: `clang-cl -c ${hostPath(repo, 'sim/f0.cpp')}`,
    }]);

    const cov = computeCompileDbCoverage({ projectRoot: repo, env: {} });
    expect(cov.complete).toBe(false);
    expect(cov.poorlyCovered).toBe(true);
    expect(cov.firstPartyCount).toBe(1);
    expect(cov.firstPartySourcesOnDisk).toBeGreaterThan(20);
    expect(cov.reason).toMatch(/covers 1 of ~\d+ first-party sources/);
    expect(cov.reason).toMatch(/unindexed/);
  });

  it('withdraws the header exemption when coverage is poor', () => {
    const buildDir = hostPath(repo, 'build');
    for (let i = 0; i < 40; i++) {
      fs.writeFileSync(path.join(repo, 'sim', `g${i}.cpp`), `void g${i}(){}\n`);
    }
    fs.writeFileSync(path.join(repo, 'sim', 'Widget.h'), '#pragma once\n');
    writeDb('build/compile_commands.json', [{
      directory: buildDir,
      file: hostPath(repo, 'sim/g0.cpp'),
      command: `clang-cl -c ${hostPath(repo, 'sim/g0.cpp')}`,
    }]);

    // With a well-covered DB a header is legitimately exempt; with a poorly
    // covered one, the TUs that include it are exactly what is missing.
    const cov = computeCompileDbCoverage({ projectRoot: repo, file: 'sim/Widget.h', env: {} });
    expect(cov.complete).toBe(false);
  });

  // A capped walk UNDER-counts sources, which inflates firstPartyCount/diskSources
  // and pushes the ratio toward granting exhaustive — the unsafe direction. An
  // incomplete measurement must read as "unknown", never as "fine".
  it('treats a walk that hit its budget as unknown coverage, not passing coverage', () => {
    const buildDir = hostPath(repo, 'build');
    const entries = [];
    // Exceed DISK_WALK_DIR_CAP so the walk stops early.
    for (let d = 0; d < 4100; d++) {
      const dir = path.join(repo, 'sim', `d${d}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'f.cpp'), 'void f(){}\n');
      if (d < 10) {
        entries.push({
          directory: buildDir,
          file: hostPath(repo, `sim/d${d}/f.cpp`),
          command: `clang-cl -c ${hostPath(repo, `sim/d${d}/f.cpp`)}`,
        });
      }
    }
    writeDb('build/compile_commands.json', entries);

    const cov = computeCompileDbCoverage({ projectRoot: repo, env: {} });
    expect(cov.firstPartyWalkCapped).toBe(true);
    expect(cov.complete).toBe(false);
    expect(cov.coverageRatio).toBeNull();
    expect(cov.reason).toMatch(/too large to enumerate/);
  });

  it('accepts an ABSOLUTE queried path (agents pass them)', () => {
    const buildDir = hostPath(repo, 'build');
    writeDb('build/compile_commands.json', [{
      directory: buildDir,
      file: hostPath(repo, 'sim/Terrain.cpp'),
      command: `clang-cl -c ${hostPath(repo, 'sim/Terrain.cpp')}`,
    }]);

    // Same file, absolute vs repo-relative — the verdict must agree. Before the
    // fix the absolute form never matched the repo-relative DB key and produced
    // a factually wrong "no compile command" reason.
    const rel = computeCompileDbCoverage({ projectRoot: repo, file: 'sim/Terrain.cpp', env: {} });
    const abs = computeCompileDbCoverage({ projectRoot: repo, file: hostPath(repo, 'sim/Terrain.cpp'), env: {} });
    expect(rel.complete).toBe(true);
    expect(abs.complete).toBe(true);
    expect(abs.fileUncovered).toBe(false);
  });

  it('does NOT penalize a queried HEADER for being absent from the DB', () => {
    // Headers legitimately have no translation unit of their own; they are
    // compiled as part of the TUs that include them.
    const buildDir = hostPath(repo, 'build-win-clangd');
    fs.writeFileSync(path.join(repo, 'sim', 'Terrain.h'), '#pragma once\n');
    writeDb('build-win-clangd/compile_commands.json', [
      {
        directory: buildDir,
        file: hostPath(repo, 'sim/Terrain.cpp'),
        command: `clang-cl -c ${hostPath(repo, 'sim/Terrain.cpp')}`,
      },
    ]);

    const cov = computeCompileDbCoverage({ projectRoot: repo, file: 'sim/Terrain.h', env: {} });

    expect(cov.complete).toBe(true);
  });

  it.runIf(!isWin)('keeps the foreign-toolchain verdict when the DB is also foreign', () => {
    // A foreign DB with zero first-party entries should still surface a reason;
    // whichever fires, it must not report complete.
    writeDb('build/compile_commands.json', [
      {
        directory: '/mnt/c/repo/build',
        file: '/mnt/c/repo/build/_deps/sdl3-src/src/audio/SDL_audio.c',
        command: 'g++ -c SDL_audio.c',
      },
    ]);
    const cov = computeCompileDbCoverage({ projectRoot: repo, env: {} });
    expect(cov.complete).toBe(false);
  });
});
