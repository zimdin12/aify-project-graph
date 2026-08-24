import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverCompileDbCandidates,
  detectToolchainMismatch,
  detectExternalRoot,
  prepareCompileDb,
} from '../../../mcp/stdio/code-intel/compile-db.js';

// Reproduces the sand_castle field case of 2026-08-25:
//   build-clangd-native/  679 clang-cl entries, rooted in the repo   <- matches host clangd
//   build-win-clangd/     679 MSVC cl.exe entries, rooted in temp    <- was SELECTED, verdict READY
// `build-clangd-native` was not in the hardcoded PROBE_DIRS allowlist, so it was never a candidate.

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-dbselect-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'fluid.cpp'), 'void relax(){}\n');
  fs.writeFileSync(path.join(dir, 'src', 'terrain.cpp'), 'void gen(){}\n');
  return dir;
}

/** Write a compile DB whose entries name `compiler` and are rooted at `directory`. */
function writeDb(repo, dirName, { compiler, directory }) {
  const dbDir = path.join(repo, dirName);
  fs.mkdirSync(dbDir, { recursive: true });
  const entries = ['src/fluid.cpp', 'src/terrain.cpp'].map((rel) => ({
    directory,
    file: path.join(repo, rel).replace(/\\/g, '/'),
    command: `${compiler} -c ${path.join(repo, rel).replace(/\\/g, '/')}`,
  }));
  fs.writeFileSync(path.join(dbDir, 'compile_commands.json'), JSON.stringify(entries));
  return path.join(dbDir, 'compile_commands.json');
}

describe('discoverCompileDbCandidates', () => {
  let repo;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('finds a DB in a build dir whose name was NOT on the old allowlist', () => {
    // THE BUG: `build-clangd-native` was absent from PROBE_DIRS, so the only toolchain-matching
    // DB in sand_castle could not be selected under any circumstances.
    writeDb(repo, 'build-clangd-native', { compiler: 'clang-cl.exe', directory: repo });
    const found = discoverCompileDbCandidates(repo);
    expect(found.some((p) => p.includes('build-clangd-native'))).toBe(true);
  });

  it('finds a DB at the repo root and in arbitrary sibling dirs, sorted', () => {
    writeDb(repo, 'zzz-custom-build', { compiler: 'clang++', directory: repo });
    writeDb(repo, 'aaa-other-build', { compiler: 'clang++', directory: repo });
    const found = discoverCompileDbCandidates(repo);
    expect(found).toHaveLength(2);
    expect(found[0] < found[1]).toBe(true); // deterministic order for stable tie-breaks
  });

  it('does not descend into directories that can never hold a build', () => {
    writeDb(repo, 'node_modules', { compiler: 'clang++', directory: repo });
    expect(discoverCompileDbCandidates(repo)).toHaveLength(0);
  });
});

describe('detectToolchainMismatch', () => {
  it('flags MSVC cl.exe, because clangd is clang and cannot consume MSVC-only flags', () => {
    const entries = [{ command: 'C:/VS/bin/cl.exe -c src/a.cpp' }];
    expect(detectToolchainMismatch(entries).mismatch).toBe(true);
    expect(detectToolchainMismatch(entries).compiler).toBe('cl');
  });

  it('does NOT flag clang-cl — an MSVC-compatible driver, but still clang', () => {
    // Getting this backwards would condemn the one DB we want people to generate; our own
    // foreign_toolchain fix text tells users to build exactly this.
    expect(detectToolchainMismatch([{ command: 'clang-cl.exe -c src/a.cpp' }]).mismatch).toBe(false);
  });

  it('does not flag gcc/clang/cc — named positively so an unknown compiler is not accused', () => {
    for (const c of ['clang++', 'g++', 'gcc', 'cc', 'some-new-compiler']) {
      expect(detectToolchainMismatch([{ command: `${c} -c src/a.cpp` }]).mismatch).toBe(false);
    }
  });

  it('reads the compiler out of an arguments array and a quoted path with spaces', () => {
    expect(detectToolchainMismatch([{ arguments: ['C:/VS/cl.exe', '-c'] }]).compiler).toBe('cl');
    expect(detectToolchainMismatch([{ command: '"C:/Program Files/LLVM/bin/clang-cl.exe" -c a.cpp' }]).compiler)
      .toBe('clang-cl');
  });

  it('claims nothing on an empty DB rather than defaulting to "fine"', () => {
    expect(detectToolchainMismatch([]).mismatch).toBe(false);
    expect(detectToolchainMismatch([]).compiler).toBeNull();
  });
});

describe('detectExternalRoot', () => {
  let repo;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('flags a DB rooted in a temp scratchpad — the observed field case', () => {
    const entries = [
      { directory: 'C:/Users/x/AppData/Local/Temp/claude/sess/scratchpad/clangdb', file: 'a.cpp' },
      { directory: 'C:/Users/x/AppData/Local/Temp/claude/sess/scratchpad/clangdb', file: 'b.cpp' },
    ];
    expect(detectExternalRoot(entries, repo).external).toBe(true);
  });

  it('does not flag a DB rooted inside the repository', () => {
    const entries = [{ directory: path.join(repo, 'build'), file: 'a.cpp' }];
    expect(detectExternalRoot(entries, repo).external).toBe(false);
  });

  it('tolerates a minority of odd entries — a handful is not a misrooted database', () => {
    const entries = [
      { directory: path.join(repo, 'build'), file: 'a.cpp' },
      { directory: path.join(repo, 'build'), file: 'b.cpp' },
      { directory: 'D:/somewhere/else', file: 'c.cpp' },
    ];
    expect(detectExternalRoot(entries, repo).external).toBe(false);
  });
});

describe('prepareCompileDb selection — the sand_castle case', () => {
  let repo;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('picks the clang-cl DB in an unlisted dir over the MSVC DB in a listed one', () => {
    // Exactly what was on disk in sand_castle. Before the fix the MSVC database won on name alone
    // and the matching one was not even a candidate.
    writeDb(repo, 'build-win-clangd', { compiler: 'cl.exe', directory: repo });
    writeDb(repo, 'build-clangd-native', { compiler: 'clang-cl.exe', directory: repo });
    const db = prepareCompileDb({ projectRoot: repo });
    expect(db.found).toBe(true);
    expect(db.sourcePath).toContain('build-clangd-native');
    expect(db.toolchainMismatch).toBe(false);
    expect(db.candidatesConsidered).toBe(2);
  });

  it('prefers a repo-rooted DB over one rooted in temp, same compiler', () => {
    writeDb(repo, 'build-a', { compiler: 'clang-cl.exe', directory: 'C:/Temp/scratch/clangdb' });
    writeDb(repo, 'build-b', { compiler: 'clang-cl.exe', directory: repo });
    const db = prepareCompileDb({ projectRoot: repo });
    expect(db.sourcePath).toContain('build-b');
    expect(db.externalRoot).toBe(false);
  });

  it('emits toolchain_mismatch AND names the better DB when only an MSVC one exists', () => {
    writeDb(repo, 'build-win-clangd', { compiler: 'cl.exe', directory: repo });
    const db = prepareCompileDb({ projectRoot: repo });
    expect(db.toolchainMismatch).toBe(true);
    const d = db.diagnostics.find((x) => x.code === 'toolchain_mismatch');
    expect(d).toBeTruthy();
    // The absence claim is the dangerous one; the message must say so.
    expect(d.message).toMatch(/safe to delete/i);
    expect(d.message).toMatch(/TRUNCATED/);
  });

  it('emits compile_db_external_root for a temp-rooted DB', () => {
    writeDb(repo, 'build-x', { compiler: 'clang-cl.exe', directory: 'C:/Temp/claude/sess/scratchpad' });
    const db = prepareCompileDb({ projectRoot: repo });
    expect(db.externalRoot).toBe(true);
    expect(db.diagnostics.some((x) => x.code === 'compile_db_external_root')).toBe(true);
  });
});
