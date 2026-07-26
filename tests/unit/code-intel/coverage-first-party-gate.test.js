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
    const buildDir = hostPath(repo, 'build-win-clangd');
    fs.writeFileSync(path.join(repo, 'sim', 'Other.cpp'), 'void o(){}\n');
    writeDb('build-win-clangd/compile_commands.json', [
      {
        directory: buildDir,
        file: hostPath(repo, 'sim/Other.cpp'),
        command: `clang-cl -c ${hostPath(repo, 'sim/Other.cpp')}`,
      },
    ]);

    // DB covers first-party code, but not the file we are asking about.
    const cov = computeCompileDbCoverage({ projectRoot: repo, file: 'sim/Terrain.cpp', env: {} });

    expect(cov.complete).toBe(false);
    expect(cov.reason).toMatch(/no compile command|not in the compile/i);
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
